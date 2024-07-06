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

const dbUrlFilterForProduct = product => {
	if (product === 'nationalExpress' || product === 'nationalExp') return 1
	if (product === 'national') return 2
	return 31
}

// todo: the data source seems to include some broken trains, which run for
// several weeks. we filter these out using some practical upper limit
const maximumDurationInHours = 210 // see also: https://en.wikipedia.org/wiki/Longest_train_services#Top_50_train_services,_by_distance

const reachableForDay = async (date, stationId, localTrainsOnly) => {
	const departures = await hafas.departures(stationId, {
		when: date,
		duration: 24 * 60, // 24h
		products: {
			nationalExpress: !localTrainsOnly,
			national: !localTrainsOnly,
			regionalExp: true,
			regional: true,
			suburban: true,
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
		// todo: make this less brittle
		if (localTrainsOnly) {
			// EuroNight (EN) services are sometimes misclassified as regional trains
			// so we filter them out manually.
			if (departure.line.name.startsWith('EN')) return []
			// since some privately operated trains are wrongly categorized as
			// regional transit, we filter them out manually. this list is
			// probably incomplete.
			if (departure.line.operator?.name === 'European Sleeper') return []
			if (departure.line.operator?.name === 'FlixTrain') return []
			if (departure.line.operator?.name === 'Snälltåget') return []
			if (departure.line.operator?.name === 'Urlaubs-Express') return []
			if (departure.line.operator?.name === 'WESTbahn') return []
		}

		const { when, nextStopovers = [] } = departure
		const passedStopovers = l.takeRightWhile(nextStopovers || [], x => ![stationId, undefined, null].includes(l.get(x, 'stop.id')))
		return passedStopovers.map(s => {
			let duration = (+new Date(s.arrival) - (+new Date(when))) / (1000 * 60)
			if (duration <= 0 || (duration / 60) > maximumDurationInHours) duration = null

			const productFilter = dbUrlFilterForProduct(departure.line.product)
			const day = moment(departure.when).tz('Europe/Berlin').format('DD.MM.YY') // todo: this might be wrong, since the first stop of the train might be on the previous day
			const dbUrlGerman = `https://reiseauskunft.bahn.de/bin/trainsearch.exe/dn?protocol=https:&rt=1&requestMode=MZP&productClassFilter=${productFilter}&trainname=${departure.line.fahrtNr}&date=${day}&stationname=${departure.stop.id}`
			const dbUrlEnglish = `https://reiseauskunft.bahn.de/bin/trainsearch.exe/en?protocol=https:&rt=1&requestMode=MZP&productClassFilter=${productFilter}&trainname=${departure.line.fahrtNr}&date=${day}&stationname=${departure.stop.id}`

			const calendarUrl = buildCalendarUrl(stationId, s.stop.id)

			return {
				id: s.stop.id,
				name: s.stop.name,
				location: s.stop.location,
				duration,
				dbUrlGerman,
				dbUrlEnglish,
				calendarUrl,
			}
		})
	}).filter(x => l.isNumber(x.duration))
	return reachable
}

export default async (req, res, next) => {
	const id = req.params.id
	if (!id || !isLocationCode(id)) return res.status(400).json({ error: true, message: 'id must be a uic station code' })
	const localTrainsOnly = boolean(req.query.localTrainsOnly)

	try {
		const baseDate = moment.tz('Europe/Berlin').add(7, 'days').startOf('day')
		const daysToAdd = l.range(7)
		const dates = daysToAdd.map(a => moment(baseDate).add(a, 'days').toDate())

		const queue = new Queue({ concurrency: 4 })
		const results = await queue.addAll(dates.map(d => () => reachableForDay(d, id, localTrainsOnly)))
		const mergedResults = l.union(...results)
		const uniqResults = l.uniqBy(l.sortBy(mergedResults, x => x.duration), x => x.id)
		res.json(uniqResults)
	} catch (error) {
		console.error(error)
		return res.status(500).json({ error: true, message: 'internal error' })
	}
}
