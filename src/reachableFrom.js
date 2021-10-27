'use strict'

import Queue from 'p-queue'
import isLocationCode from 'is-uic-location-code'
import createHafas from 'db-hafas'
import moment from 'moment-timezone'
import { boolean } from 'boolean'
import l from 'lodash'

const hafas = createHafas('direkt.bahn.guru')

const err = (msg, code) => {
	const e = new Error(msg)
	e.statusCode = code
	return e
}

const isTrainDeparture = departure =>
	l.get(departure, 'line.mode') === 'train' && (departure.line.name || '').slice(0, 3).toLowerCase() !== 'bus'

// todo: the data source seems to include some broken trains, which run for
// several weeks. we filter these out using some practical upper limit
const maximumDurationInHours = 210 // see also: https://en.wikipedia.org/wiki/Longest_train_services#Top_50_train_services,_by_distance

const reachableForDay = async (date, stationId, allowLocalTrains) => {
	const departures = await hafas.departures(stationId, {
		when: date,
		duration: 24 * 60, // 24h
		products: {
			nationalExpress: true,
			national: true,
			regionalExp: allowLocalTrains,
			regional: allowLocalTrains,
			suburban: false,
			bus: false,
			ferry: false,
			subway: false,
			tram: false,
			taxi: false,
		},
		stopovers: true,
		remarks: false,
	})

	const trainDepartures = departures.filter(isTrainDeparture)
	const reachable = l.flatMap(trainDepartures, departure => {
		const { when, nextStopovers = [] } = departure
		const passedStopovers = l.takeRightWhile(nextStopovers || [], x => ![stationId, undefined, null].includes(l.get(x, 'stop.id')))
		return passedStopovers.map(s => {
			let duration = (+new Date(s.arrival) - (+new Date(when))) / (1000 * 60)
			if (duration <= 0 || (duration / 60) > maximumDurationInHours) duration = null
			return {
				id: s.stop.id,
				name: s.stop.name,
				location: s.stop.location,
				duration,
			}
		})
	}).filter(x => l.isNumber(x.duration))
	return reachable
}

export default async (req, res, next) => {
	const id = req.params.id
	if (!id || !isLocationCode(id)) return next(err('id must be a uic station code', 400))
	const allowLocalTrains = boolean(req.query.allowLocalTrains)

	try {
		const baseDate = moment.tz('Europe/Berlin').add(7, 'days').startOf('day')
		const daysToAdd = l.range(7)
		const dates = daysToAdd.map(a => moment(baseDate).add(a, 'days').toDate())

		const queue = new Queue({ concurrency: 4 })
		const results = await queue.addAll(dates.map(d => () => reachableForDay(d, id, allowLocalTrains)))
		const mergedResults = l.union(...results)
		const uniqResults = l.uniqBy(l.sortBy(mergedResults, x => x.duration), x => x.id)
		res.json(uniqResults)
	} catch (e) {
		console.error(e)
		res.status(500).json({ error: true })
	}
}
