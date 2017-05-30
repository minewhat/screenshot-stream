/* global phantom, document, window, btoa */
'use strict';
var system = require('system');
var page = require('webpage').create();
var objectAssign = require('object-assign');

var opts = JSON.parse(system.args[1]);
var log = console.log;

function formatTrace(trace) {
	var src = trace.file || trace.sourceURL;
	var fn = (trace.function ? ' in function ' + trace.function : '');
	return ' → ' + src + ' on line ' + trace.line + fn;
}

console.log = console.error = function () {
	system.stderr.writeLine([].slice.call(arguments).join(' '));
};

if (opts.username && opts.password) {
	opts.headers = objectAssign({}, opts.headers, {
		Authorization: 'Basic ' + btoa(opts.username + ':' + opts.password)
	});
}

if (opts.userAgent) {
	page.settings.userAgent = opts.userAgent;
}

if(opts.noImages) {
	page.settings.loadImages = false;
}

page.settings.resourceTimeout = (opts.timeout || 60) * 1000;

phantom.cookies = opts.cookies;

phantom.onError = function (err, trace) {
	err = err.replace(/\n/g, '');
	console.error('PHANTOM ERROR: ' + err + formatTrace(trace[0]));
	phantom.exit(1);
};

page.onError = function (err, trace) {
	err = err.replace(/\n/g, '');
	console.error('WARN: ' + err + formatTrace(trace[0]));
};

page.onResourceError = function (resourceError) {
	console.error('WARN: Unable to load resource #' + resourceError.id + ' (' + resourceError.errorString + ') → ' + resourceError.url);
};

page.onResourceTimeout = function (resourceTimeout) {
	console.error('Resource timed out #' + resourceTimeout.id + ' (' + resourceTimeout.errorString + ') → ' + resourceTimeout.url);
	phantom.exit(1);
};

page.viewportSize = {
	width: opts.width,
	height: opts.height
};

page.customHeaders = opts.headers || {};
page.zoomFactor = opts.scale;

var requestsArray = [];

page.onResourceRequested = function(requestData, networkRequest) {
	// update the timestamp when there is a request
	// last_timestamp = getTimestamp();
	// console.log("REQ",JSON.stringify(requestData.url));
	requestsArray.push(requestData.id);
};
page.onResourceReceived = function(response) {
	// update the timestamp when there is a response
	// last_timestamp = getTimestamp();

	// console.log("response",JSON.stringify(response.url),response.stage);
	// If request is complete, remove it from requestsArray
	if(response.stage==="end"){
		var index = requestsArray.indexOf(response.id);
		requestsArray.splice(index, 1);
	}
};


// Checks every 0.5 secs if page is loaded && last network interaction was > 1 secs ago && all requests are completed
// Currently checking only for all requests every 0.5 secs
function checkReadyState(callback) {
	setTimeout(function() {
		// var current_timestamp = getTimestamp();

		var readyState = page.evaluate(function () {
			return (document.readyState === "interactive" || document.readyState === "complete");
		});

		// if (readyState === "complete" && current_timestamp-last_timestamp > 1000 && requestsArray.length === 0) {
		if (readyState && requestsArray.length === 0) {
			callback();
		}else{
			checkReadyState(callback);
		}
	}, 500);
}

page.open(opts.url, function (status) {
	if (status === 'fail') {
		console.error('Couldn\'t load url: ' + opts.url);
		phantom.exit(1);
		return;
	}
	checkReadyState(pageReady);
})

function pageReady() {

	if (opts.crop) {
		page.clipRect = {
			top: 0,
			left: 0,
			width: opts.width,
			height: opts.height
		};
	}

	page.evaluate(function (css) {
		var bgColor = window
			.getComputedStyle(document.body)
			.getPropertyValue('background-color');

		if (!bgColor || bgColor === 'rgba(0, 0, 0, 0)') {
			document.body.style.backgroundColor = 'white';
		}

		if (css) {
			var el = document.createElement('style');
			el.appendChild(document.createTextNode(css));
			document.head.appendChild(el);
		}
	}, opts.css);


	setTimeout(function () {
		if (opts.hide) {
			page.evaluate(function (els) {
				els.forEach(function (el) {
					[].forEach.call(document.querySelectorAll(el), function (e) {
						e.style.visibility = 'hidden';
					});
				});
			}, opts.hide);
		}

		if (opts.selector) {
			var clipRect = page.evaluate(function (el) {
				return document
					.querySelector(el)
					.getBoundingClientRect();
			}, opts.selector);

			clipRect.height *= page.zoomFactor;
			clipRect.width *= page.zoomFactor;
			clipRect.top *= page.zoomFactor;
			clipRect.left *= page.zoomFactor;

			page.clipRect = clipRect;
		}

		if (opts.script) {
			page.evaluateJavaScript('function () { ' + opts.script + '}');
		}

		// <--------------------- CUSTOMISED CODE BELOW --------------->
		// Kept separate to avoid conflicts due to future pulls

		// To get selector based snapshot with margin percentage (percentage based on available screen area)
		// author: harkirat
		if(opts.focusSelector && opts.focusSelector.selector) {
			var xMarginPercent = opts.focusSelector.horizMargin || 0;
			var yMarginPercent = opts.focusSelector.vertMargin || 0;

			var focusRect = page.evaluate(function (el) {
				return document.querySelector(el).getBoundingClientRect();
			}, opts.focusSelector.selector);


			if(yMarginPercent > 0 && yMarginPercent <= 1){
				var availableVertMargin = opts.height - focusRect.height;
				var extraVertHeight = availableVertMargin * yMarginPercent;
				focusRect.height += extraVertHeight;

				focusRect.top -= extraVertHeight / 2;
			}

			if(xMarginPercent > 0 && xMarginPercent <= 1){
				var availableHorizMargin = opts.width - focusRect.width;
				var extraHorizWidth = availableHorizMargin * xMarginPercent;
				focusRect.width += extraHorizWidth;

				focusRect.left -= extraHorizWidth / 2;
			}

			page.clipRect = focusRect;
		}

		// To get area till certain pixels only
		// author: harkirat
		if(opts.vertOffset) {
			page.clipRect = {
				top: 0,
				left: 0,
				height: opts.vertOffset,
				width: opts.width
			};
		}

		log.call(console, page.renderBase64(opts.format));
		phantom.exit();

	}, opts.delay * 1000);
}
