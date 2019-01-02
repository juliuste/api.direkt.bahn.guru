'use strict'

const Queue = require('p-queue')
const isLocationCode = require('is-uic-location-code')
const createClient = require('hafas-client')
const dbProfile = require('hafas-client/p/db')
const hafas = createClient(dbProfile, 'direkt.bahn.guru')
const moment = require('moment-timezone')
const l = require('lodash')

const err = (msg, code) => {
	const e = new Error(msg)
	e.statusCode = code
	return e
}

const reachableForDay = async (date, stationId) => {
	const departures = await hafas.departures(stationId, {
		when: date,
		duration: 24 * 60, // 24h
		products: {
			nationalExp: true,
			national: true,
			regionalExp: false,
			regional: false,
			suburban: false,
			bus: false,
			ferry: false,
			subway: false,
			tram: false,
			taxi: false
		}
	})
	const trainDepartures = departures.filter(d => d.line && d.line.mode === 'train' && (!d.line.name || d.line.name.slice(0, 3).toLowerCase() !== 'bus'))
	const reachable = l.flatMap(trainDepartures, d => {
		const baseDate = d.when
		const passedStopovers = l.takeRightWhile((d.stopovers || []), x => x.stop && x.stop.id && x.stop.id !== stationId)
		return passedStopovers.map(s => {
			let duration = ((+new Date(s.arrival)) - (+new Date(baseDate))) / (1000 * 60)
			if (duration <= 0) duration = null
			return {
				id: s.stop.id,
				name: s.stop.name,
				location: s.stop.location,
				duration
			}
		})
	})
	return reachable
}

module.exports = async (req, res, next) => {
	const id = req.params.id
	if (!id || !isLocationCode(id)) return next(err('id must be a uic station code', 400))

	try {
		const baseDate = moment.tz('Europe/Berlin').add(7, 'days').startOf('day')
		const daysToAdd = l.range(7)
		const dates = daysToAdd.map(a => moment(baseDate).add(a, 'days').toDate())

		const queue = new Queue({ concurrency: 4 })
		const results = await queue.addAll(dates.map(d => () => reachableForDay(d, id)))
		const mergedResults = l.union(...results)
		const uniqResults = l.uniqBy(l.sortBy(mergedResults, x => x.duration), x => x.id)
		res.json(uniqResults)
	} catch (e) {
		next(err('Something went wrong', 500))
	}
}
