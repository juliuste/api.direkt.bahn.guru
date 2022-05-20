'use strict'

import Queue from 'p-queue'
import isLocationCode from 'is-uic-location-code'
import createHafas from 'db-hafas'
import moment from 'moment-timezone'
import { boolean } from 'boolean'
import l from 'lodash'
import { stringify } from 'query-string'
import { formatHafasStationId } from './stations.js'

const hafas = createHafas('direkt.bahn.guru')

export const buildCalendarUrl = (originId, destinationId) => {
	const query = {
		origin: formatHafasStationId(originId),
		destination: formatHafasStationId(destinationId),
		submit: 'Suchen',
		class: 2,
		bc: 0,
		departureAfter: null,
		arrivalBefore: null,
		duration: null,
		maxChanges: 0,
		weeks: 4,
	}
	return `https://bahn.guru/calendar?${stringify(query)}`
}

const isTrainDeparture = departure =>
	l.get(departure, 'line.mode') === 'train' && (departure.line.name || '').slice(0, 3).toLowerCase() !== 'bus'

// todo: the data source seems to include some broken trains, which run for
// several weeks. we filter these out using some practical upper limit
const maximumDurationInHours = 210 // see also: https://en.wikipedia.org/wiki/Longest_train_services#Top_50_train_services,_by_distance

const reachableForDay = async (date, stationId, allowLocalTrains, allowSuburbanTrains) => {
	const departures = await hafas.departures(stationId, {
		when: date,
		duration: 24 * 60, // 24h
		products: {
			nationalExpress: true,
			national: true,
			regionalExp: allowLocalTrains,
			regional: allowLocalTrains,
			suburban: allowSuburbanTrains,
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

			const line = departure.line.name.replace(/\s+\d+$/i, ` ${departure.line.fahrtNr}`) // todo
			const day = moment(departure.when).tz('Europe/Berlin').format('DD.MM.YY') // todo: this might be wrong, since the first stop of the train might be on the previous day
			const dbUrl = `https://reiseauskunft.bahn.de/bin/trainsearch.exe/dn?protocol=https:&rt=1&trainname=${encodeURIComponent(line)}&date=${day}&stationname=${departure.stop.id}` // todo: ?stationname

			const calendarUrl = buildCalendarUrl(stationId, s.stop.id)

			return {
				id: s.stop.id,
				name: s.stop.name,
				location: s.stop.location,
				duration,
				dbUrl,
				calendarUrl,
			}
		})
	}).filter(x => l.isNumber(x.duration))
	return reachable
}

export default async (req, res, next) => {
	const id = req.params.id
	if (!id || !isLocationCode(id)) return res.status(400).json({ error: true, message: 'id must be a uic station code' })
	const allowLocalTrains = boolean(req.query.allowLocalTrains)
	const allowSuburbanTrains = boolean(req.query.allowSuburbanTrains)

	try {
		const baseDate = moment.tz('Europe/Berlin').add(7, 'days').startOf('day')
		const daysToAdd = l.range(7)
		const dates = daysToAdd.map(a => moment(baseDate).add(a, 'days').toDate())

		const queue = new Queue({ concurrency: 4 })
		const results = await queue.addAll(dates.map(d => () => reachableForDay(d, id, allowLocalTrains, allowSuburbanTrains)))
		const mergedResults = l.union(...results)
		const uniqResults = l.uniqBy(l.sortBy(mergedResults, x => x.duration), x => x.id)
		res.json(uniqResults)
	} catch (error) {
		console.error(error)
		return res.status(500).json({ error: true, message: 'internal error' })
	}
}
