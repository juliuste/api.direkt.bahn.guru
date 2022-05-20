import cleanStationName from 'db-clean-station-name'
import fs from 'fs'
import isUicLocationCode from 'is-uic-location-code'
import countries from 'i18n-iso-countries'
import fetch from 'node-fetch'
import { dirname, resolve } from 'path'
import uicCodes from 'uic-codes'
import { fileURLToPath } from 'url'

const stationsMap = new Map(Object.entries(JSON.parse(fs.readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), './stations.json')))))

const fetchStations = async query => {
	return Promise.race([
		fetch(`https://v5.db.transport.rest/locations?query=${query}&poi=false&addresses=false`),
		fetch(`https://v5.db.juliustens.eu/locations?query=${query}&poi=false&addresses=false`),
	]).then(res => res.json())
}

export const formatHafasStationId = i => (i.length === 9 && i.slice(0, 2)) ? i.slice(2) : i

const hafasStationIsLongDistanceOrRegionalOrSuburban = s => {
	return s.products && (s.products.nationalExp || s.products.nationalExpress || s.products.national || s.products.regionalExp || s.products.regionalExpress || s.products.regional || s.products.suburban) && isUicLocationCode(formatHafasStationId(s.id))
}

const hafasStationIsNotRegion = hafasStation => {
	return hafasStation.name.toUpperCase() !== hafasStation.name
}

const fixHafasStationId = hafasStation => ({
	...hafasStation,
	id: formatHafasStationId(hafasStation.id),
})

const countryForStationId = id => {
	if (!isUicLocationCode(id)) return undefined
	const countryPrefix = +id.slice(0, 2)
	const alpha3 = uicCodes.toISO[countryPrefix]
	return alpha3 ? countries.alpha3ToAlpha2(alpha3) : undefined
}

const stationHasLocation = station => {
	return !!station.location
}

const fixStationName = station => ({
	...station,
	name: cleanStationName(station.name),
})

const createStation = hafasStation => {
	const matchingEntry = stationsMap.get(hafasStation.id)
	return matchingEntry || {
		id: hafasStation.id,
		name: hafasStation.name, // todo
		isMeta: false,
		country: countryForStationId(hafasStation.id),
		location: hafasStation.location
			? {
				longitude: hafasStation.location.longitude,
				latitude: hafasStation.location.latitude,
			}
			: undefined,
	}
}

export const stationsByQuery = async (req, res) => {
	const { query } = req.query
	if (!query) return res.status(400).json({ error: true, message: 'missing `query` parameter' })

	try {
		const hafasStations = await fetchStations(query)
		const stations = hafasStations
			.filter(hafasStationIsLongDistanceOrRegionalOrSuburban)
			.filter(hafasStationIsNotRegion)
			.map(fixHafasStationId)
			.map(createStation)
			.filter(stationHasLocation)
			.map(fixStationName)
		return res.json(stations)
	} catch (error) {
		console.error(error)
		return res.status(500).json({ error: true, message: 'internal error' })
	}
}

export const stationById = async (req, res) => {
	const { id } = req.params
	if (!id) return res.status(400).json({ error: true, message: 'missing `id` path parameter' })

	try {
		const maybeStation = stationsMap.get(String(req.params.id))
		if (maybeStation) return res.json(maybeStation)

		const hafasCandidates = await fetchStations(String(id))
		const [station] = hafasCandidates
			.map(fixHafasStationId)
			.filter(hafasStation => hafasStation.id === String(id))
			.map(createStation)
			.map(fixStationName)

		if (station) return res.json(station)
		return res.status(404).json({ error: true, message: 'station not found' })
	} catch (error) {
		console.error(error)
		return res.status(500).json({ error: true, message: 'internal error' })
	}
}
