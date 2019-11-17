'use strict'

const express = require('express')
const http = require('http')
const corser = require('corser')
const compression = require('compression')
const cache = require('apicache')

const reachableFrom = require('./reachableFrom')

const api = express()
const server = http.createServer(api)

// enable caching
cache.options({ appendKey: () => 'v2' })
api.use(cache.middleware('24 hours'))

const allowed = corser.simpleResponseHeaders.concat(['Access-Control-Allow-Origin'])
api.use(corser.create({ responseHeaders: allowed })) // CORS
api.use(compression())

api.get('/:id', reachableFrom)

api.use((err, req, res, next) => {
	if (res.headersSent) return next()
	res.status(err.statusCode || 500).json({ error: true, msg: err.message })
	next()
})

const port = 3072 // @todo
server.listen(port, error => {
	if (error) {
		console.error(error)
		process.exit(1)
	}
	console.log(`Listening on ${port}.`)
})
