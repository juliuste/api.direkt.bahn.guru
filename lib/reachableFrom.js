'use strict'

const Queue = require('p-queue').default
const isLocationCode = require('is-uic-location-code')
const hafas = require('db-hafas')('direkt.bahn.guru')
const moment = require('moment-timezone')
const { boolean } = require('boolean')
const cleanStationName = require('db-clean-station-name')
const l = require('lodash')

const err = (msg, code) => {
	const e = new Error(msg)
	e.statusCode = code
	return e
}

const isTrainDeparture = departure =>
	l.get(departure, 'line.mode') === 'train' && (departure.line.name || '').slice(0, 3).toLowerCase() !== 'bus'

const reachableForDay = async (date, stationId, allowLocalTrains) => {
	const departures = await hafas.departures(stationId, {
		when: date,
		duration: 24 * 60, // 24h
		products: {
			nationalExpress: true,
			national: true,
			regionalExp: allowLocalTrains,
			regional: allowLocalTrains,
			suburban: allowLocalTrains,
			bus: false,
			ferry: false,
			subway: false,
			tram: false,
			taxi: false
		},
		stopovers: true,
		remarks: false
	})

	const trainDepartures = departures.filter(isTrainDeparture)
	const reachable = l.flatMap(trainDepartures, departure => {
		const { when, nextStopovers = [] } = departure
		const passedStopovers = l.takeRightWhile(nextStopovers || [], x => ![stationId, undefined, null].includes(l.get(x, 'stop.id')))
		return passedStopovers.map(s => {
			let duration = (new Date(s.arrival) - new Date(when)) / (1000 * 60)
			if (duration <= 0) duration = null
			return {
				id: s.stop.id,
				name: cleanStationName(s.stop.name),
				location: s.stop.location,
				duration
			}
		})
	}).filter(x => l.isNumber(x.duration))
	return reachable
}

module.exports = async (req, res, next) => {
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
		next(err('Something went wrong', 500))
	}
}
