var mage = require('mage-sdk-js');
var EventEmitter = require('events');
var serializeArguments = require('./serialize.js');

var logLevels = {};

var logger = new EventEmitter();

module.exports = logger;


/*jshint -W079 */ // ignore redefine error
var console = window.console;
/*jshint +W079 */

// Make default console object if non-existent

if (!console) {
	/*jshint -W020 */ // ignore read only error
	console = {
		log: function () {},
		warn: function () {},
		error: function () {}
	};
	/*jshint +W020 */
}


// Channel dictionary

var consoleLogChannels = {
	log: 'debug',
	debug: 'debug',
	info: 'notice',
	warn: 'warning',
	error: 'error'
};


// Make safe copies of console log methods

Object.keys(consoleLogChannels).forEach(function (methodName) {
	if (typeof console[methodName] === 'function') {
		// Default for all recent browsers
		console['_' + methodName] = console[methodName];
	} else if (typeof console[methodName] === 'object') {
		// Exist as object in IE9, rebinding to use it as function
		console['_' + methodName] = Function.prototype.bind.call(console[methodName], console);
	}
});


function setChannelFunction(channelName) {
	if (logger[channelName]) {
		// already set
		return;
	}

	logger[channelName] = function log() {
		logger.emit(channelName, arguments);
	};
}


// Writer classes
// --------------

// Console

function ConsoleWriter() {
}


ConsoleWriter.prototype.addChannel = function (channelName) {
	var slice = Array.prototype.slice;
	var prefix = ['[' + channelName + ']'];
	var logLevel = logLevels[channelName] || 0;
	var fn;

	if (logLevel > logLevels.warning) {
		fn = console._error;
	}

	if (!fn && logLevel >= logLevels.notice) {
		fn = console._warn;
	}

	if (!fn) {
		fn = console._log;
	}

	logger.on(channelName, function writeToConsole(args) {
		args = prefix.concat(slice.call(args));

		fn.apply(console, args);
	});
};


// Server

function ServerWriter() {
}

ServerWriter.prototype.addChannel = function (channelName) {
	if (!logger.hasOwnProperty('sendReport')) {
		console._error('logger.sendReport usercommand is not exposed.', channelName);
		return;
	}

	// make sure transport errors won't be reported

	var ignoreIncoming = false;

	mage.eventManager.on('io.send', function () {
		ignoreIncoming = true;
	});

	mage.eventManager.on('io.response', function () {
		ignoreIncoming = false;
	});

	// calculate browser info

	var nav = window.navigator || {};

	var clientInfo = {
		userAgent: nav.userAgent || 'unknown'
	};


	logger.on(channelName, function (args) {
		if (ignoreIncoming) {
			// don't log that a sendReport failed because of network conditions, it's overkill.
			return;
		}

		var report = serializeArguments(args);

		if (!report.data) {
			report.data = {};
		}

		report.data.clientInfo = clientInfo;

		mage.commandCenter.queue(function () {
			logger.sendReport(channelName, report.message, report.data, function (error) {
				if (error) {
					console._error('Could not forward logs to remote server:', error);
				}
			});
		});
	});
};


var writerClasses = {
	console: ConsoleWriter,
	server: ServerWriter
};


var writers = {};

function getOrCreateWriter(writerType) {
	var writer = writers[writerType];

	if (writer) {
		return writer;
	}

	var WriterClass = writerClasses[writerType];

	if (!WriterClass) {
		console.error('Unknown writer type:', writerType);
		return;
	}

	writer = new WriterClass();

	writers[writerType] = writer;

	return writer;
}


function setupChannels(config) {
	var allChannelNames = Object.keys(logLevels);

	for (var i = 0, len = allChannelNames.length; i < len; i++) {
		var channelName = allChannelNames[i];

		// make sure events are emitted for this channel

		setChannelFunction(channelName);

		// if there are any writers that care about this channel, make them listen for it

		for (var writerType in config) {
			var writerChannels = config[writerType];
			var writer = getOrCreateWriter(writerType);

			if (writer && writerChannels.indexOf(channelName) !== -1) {
				writer.addChannel(channelName);
			}
		}
	}
}


logger.setup = function (cb) {
	if (!logger.hasOwnProperty('sync')) {
		return cb('Could not sync: logger.sync is not exposed.');
	}

	logger.sync(function (error, data) {
		if (error) {
			return cb(error);
		}

		if (!data) {
			return cb();
		}

		logLevels = data.logLevels;

		setupChannels(data.config);

		if (!data.disableOverride) {
			logger.overrideConsole();
			logger.logUncaughtExceptions('error', false);
		}

		cb();
	});
};


logger.overrideConsole = function () {
	Object.keys(consoleLogChannels).forEach(function (methodName) {
		var channelName = consoleLogChannels[methodName];

		console[methodName] = function readFromConsole() {
			logger.emit(channelName, arguments);
		};
	});
};


logger.logUncaughtExceptions = function (channelName, continueErrorFlow) {
	// be aware: not all browsers implement column and error

	var ErrorEvent = window.ErrorEvent;

	if (window.onerror) {
		logger.debug('window.onerror was already assigned, overwriting.');
	}

	window.onerror = function (message, url, lineno, colno, error) {
		// The ErrorEvent object gives us the most information but not all browsers support it.
		// Extract it from the first argument, or from the window object if possible.

		if (ErrorEvent && message instanceof ErrorEvent) {
			// ErrorEvent as first argument

			logger.emit(channelName, [message]);
		} else if (ErrorEvent && window.event instanceof ErrorEvent) {
			// ErrorEvent on window.event

			logger.emit(channelName, [window.event]);
		} else {
			// There is no ErrorEvent object, so we create something similar
			// note: colno is not passed by older browsers

			var args = [{
				message: message,
				url: url,
				lineno: lineno,
				colno: colno
			}];

			// modern browsers will add the thrown error object as the 5th argument

			if (error) {
				args.push(error);
			}

			logger.emit(channelName, args);
		}

		if (!continueErrorFlow) {
			// this doesn't work when using addEventListener instead of direct assignment to onerror

			return true;
		}
	};
};

