'use strict'

const express = require('express')
const http = require('http')
const cors = require('cors')
const compression = require('compression')
const cache = require('apicache')
const robots = require('express-robots-txt')

const reachableFrom = require('./reachableFrom')

const port = process.env.PORT
if (!port) throw new Error('please provide a PORT environment variable')

const api = express()
const server = http.createServer(api)
api.use(cors())

// enable caching
// todo: use a global cache (redis?) here
cache.options({ appendKey: () => 'v3' })
api.use(cache.middleware('24 hours'))

api.use(compression())
api.use(robots({ UserAgent: '*', Disallow: '/' }))

api.get('/:id', reachableFrom)

api.use((err, req, res, next) => {
	if (res.headersSent) return next()
	res.status(err.statusCode || 500).json({ error: true, msg: err.message })
	next()
})

server.listen(port, error => {
	if (error) {
		console.error(error)
		process.exit(1)
	}
	console.log(`Listening on ${port}.`)
})
