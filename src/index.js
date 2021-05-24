'use strict'

const express = require('express')
const http = require('http')
const corser = require('corser')
const compression = require('compression')
const cache = require('apicache')
const robots = require('express-robots-txt')

const reachableFrom = require('./reachableFrom')

const port = process.env.PORT
if (!port) throw new Error('please provide a PORT environment variable')

const api = express()
const server = http.createServer(api)

// enable caching
cache.options({ appendKey: () => 'v3' })
api.use(cache.middleware('24 hours'))

api.use(corser.create())
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
