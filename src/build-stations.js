import fromPairs from 'lodash/fromPairs.js'
import countriesList from 'countries-list'
import fetchTrainlineStations, { collect } from 'trainline-stations'

const buildStations = async () => {
	console.error('fetching latest stations…')
	const rawStations = await collect(fetchTrainlineStations())

	console.error('building station dataset…')
	const validAndFormattedStations = rawStations
		.flatMap(s => {
			if (!(s.id && s.db_id && s.name && s.is_suggestable && countriesList.countries[s.country] && s.longitude && +s.longitude < 180 && s.latitude && +s.latitude < 90)) return []
			const id = String(s.db_id)
			return [{
				id: (id.length === 9 && id.slice(0, 2)) ? id.slice(2) : id,
				name: s.name,
				isMeta: s.is_city,
				country: s.country,
				location: {
					longitude: +s.longitude,
					latitude: +s.latitude,
				},
			}]
		})

	console.error('done.')
	return fromPairs(validAndFormattedStations.map(s => [s.id, s]))
}

buildStations()
	.then(stations => process.stdout.write(JSON.stringify(stations, null, 2)))
	.catch(error => {
		console.error(error)
		process.exit(1)
	})
