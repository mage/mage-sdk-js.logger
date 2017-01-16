var trace = require('stacktrace-js');

// Try to detect the line offset of stack traces when the Function constructor is used.

var lineOffset = (function () {
	/*jshint evil:true */
	var f = new Function('bogus', 'throw new Error("test");');

	try {
		f(true);
	} catch (error) {
		var stack;

		try {
			stack = trace({ e: error });
		} catch (traceError) {
			return;
		}

		if (!Array.isArray(stack) || typeof stack[0] !== 'string') {
			return;
		}

		var m = stack[0].match(/:([0-9]+)(:[0-9]+)?$/);
		if (m) {
			var line = parseInt(m[1], 10);

			if (line < 1 || line > 5) {
				// outside reasonable range
				return;
			}

			// example: If the first line of code ended up on line 3, the offset becomes -2
			//          Next time we calculate line numbers, 3 + -2 will yield line 1.

			return -(line - 1);
		}
	}
}());


function processErrorStack(error) {
	if (typeof lineOffset === 'number') {
		try {
			var stack = trace({ e: error });

			if (lineOffset !== 0) {
				stack = stack.map(function (frame) {
					return frame.replace(/:([0-9]+):([0-9]+)$/, function (m, line, row) {
						return ':' + (parseInt(line, 10) + lineOffset) + ':' + row;
					});
				});
			}

			return stack;
		} catch (traceError) {
			// we can only ignore this problem at this point
		}
	}

	// This browser and/or stacktrace.js suck at stack resolution. Let's simply make sure the stack
	// is an array and leave it at that.

	return typeof error.stack === 'string' ? error.stack.split('\n') : error.stack;
}


module.exports = function serializeError(error) {
	return {
		name: error.name,
		message: error.message,
		fileName: error.fileName,
		lineNumber: error.lineNumber,
		stack: processErrorStack(error)
	};
};

