import _ from 'lodash';
import appc from 'node-appc';
import fs from 'fs';
import { GawkArray, GawkObject } from 'gawk';
import path from 'path';

if (!Error.prepareStackTrace) {
	require('source-map-support/register');
}

/**
 * The scanner instance used to scan paths and cache per-path results returned
 * by the detectFn `isJDK()`.
 * @type {Scanner}
 */
const scanner = new appc.detect.Scanner;

/**
 * A map of the hash of the JDK paths or watch uuid to the resulting GawkArray.
 * @type {Object}
 */
const cache = {};

/**
 * Common search paths for the JVM library. This is used only for validating if
 * a directory is a JDK.
 * @type {Object}
 */
const libjvmLocations = {
	linux: [
		'lib/amd64/client/libjvm.so',
		'lib/amd64/server/libjvm.so',
		'lib/i386/client/libjvm.so',
		'lib/i386/server/libjvm.so',
		'jre/lib/amd64/client/libjvm.so',
		'jre/lib/amd64/server/libjvm.so',
		'jre/lib/i386/client/libjvm.so',
		'jre/lib/i386/server/libjvm.so'
	],
	darwin: [
		'jre/lib/server/libjvm.dylib',
		'../Libraries/libjvm.dylib'
	],
	win32: [
		'jre/bin/server/jvm.dll',
		'jre/bin/client/jvm.dll'
	]
};

/**
 * Resets the internal detection result cache. This is intended for testing
 * purposes.
 */
export function resetCache() {
	for (const key of Object.keys(cache)) {
		delete cache[key];
	}
	scanner.cache = {};
}

/**
 * JDK information object.
 */
export class JDK extends GawkObject {
	constructor(dir) {
		if (typeof dir !== 'string' || !dir) {
			throw new TypeError('Expected directory to be a valid string');
		}

		dir = appc.path.expand(dir);
		if (!appc.fs.existsSync(dir)) {
			throw new Error('Directory does not exist');
		}

		// on OS X, the JDK lives in Contents/Home
		if (process.platform === 'darwin') {
			const p = path.join(dir, 'Contents', 'Home');
			if (appc.fs.existsSync(p)) {
				dir = p;
			}
		}

		const libjvms = libjvmLocations[process.platform];
		if (!libjvms || !libjvms.some(p => appc.fs.existsSync(path.resolve(dir, p)))) {
			throw new Error('Directory does not contain a JDK');
		}

		const values = {
			path: dir,
			version: null,
			build: null,
			architecture: null,
			executables: {},
			default: false
		};

		if (!['java', 'javac', 'keytool', 'jarsigner'].every(cmd => {
			const p = path.join(dir, 'bin', cmd + appc.subprocess.exe);
			if (appc.fs.existsSync(p)) {
				values.executables[cmd] = fs.realpathSync(p);
				return true;
			}
		})) {
			throw new Error('Directory does not contain a JDK');
		}

		super(values);
	}

	/**
	 * Fetches the JDK version and architecture by running javac.
	 *
	 * @returns {Promise}
	 */
	init() {
		const javac = this.get(['executables', 'javac']).toJS();
		if (!javac) {
			return Promise.resolve();
		}

		// try the 64-bit version first
		return appc.subprocess.run(javac, ['-version', '-d64'])
			.then(({ stdout, stderr }) => {
				// 64-bit version
				return { output: stderr, arch: '64bit' };
			})
			.catch(err => {
				// try the 32-bit version
				return appc.subprocess.run(javac, ['-version'])
					.then(({ code, stdout, stderr }) => {
						return { output: stderr, arch: '32bit' };
					});
			})
			.then(({ output, arch }) => {
				const m = output.match(/javac (.+)_(.+)/);
				this.merge({
					version: m && m[1] || null,
					build: m && parseInt(m[2]) || null,
					architecture: arch
				});
				return this;
			});
	}
}

/**
 * Detects installed JDKs.
 *
 * @param {Object} [opts] - An object with various params.
 * @param {Boolean} [opts.ignorePlatformPaths=false] - When true, doesn't search
 * well known platform specific paths.
 * @param {Array} [opts.paths] - One or more paths to known JDKs.
 * @param {Boolan} [opts.gawk] - If true, returns the raw internal GawkArray,
 * otherwise returns a JavaScript array.
 * @returns {Promise} Resolves an object or GawkObject containing the values.
 */
export function detect(opts = {}) {
	return Promise.resolve()
		.then(() => getPathInfo(opts))
		.then(pathInfo => {
			return scanner.scan({ paths: pathInfo.paths, force: opts.force, detectFn: isJDK, depth: 1 })
				.then(results => processJDKs(results, appc.util.sha1(JSON.stringify(pathInfo.paths)), pathInfo.defaultPath));
		})
		.then(results => opts.gawk ? results : results.toJS());
}

/**
 * Detects installed JDKs and watches for changes.
 *
 * @param {Object} [opts] - An object with various params.
 * @param {Boolean} [opts.ignorePlatformPaths=false] - When true, doesn't search
 * well known platform specific paths.
 * @param {Array} [opts.paths] - One or more paths to known JDKs.
 * @param {Boolan} [opts.gawk] - If true, returns the raw internal GawkArray,
 * otherwise returns a JavaScript array.
 * @param {Number} [opts.pathRescanInterval=30000] - The number of milliseconds
 * to check if the search paths have changed. This is used on only Windows.
 * @returns {WatchHandle}
 */
export function watch(opts = {}) {
	const handle = new appc.detect.WatchHandle;
	const uuid = appc.util.randomBytes(10);
	const pathRescanInterval = Math.max(~~opts.pathRescanInterval || 5000, 1000);
	let lastPathInfo = null;
	let timer = null;
	let jdks = null;

	handle.unwatchers.set('__clearPathRescanTimer__', () => {
		clearTimeout(timer);
		timer = null;
	});

	function rescan(pathInfo) {
		const lookup = {};

		for (const dir of pathInfo.paths) {
			lookup[dir] = 1;
			if (!handle.unwatchers.has(dir)) {
				handle.unwatchers.set(dir, appc.fs.watch(dir, _.debounce(evt => {
					scanner.scan({ paths: pathInfo.paths, onlyPaths: [dir], force: true, detectFn: isJDK, depth: 1 })
						.then(results => processJDKs(results, uuid, pathInfo.defaultPath))
						.catch(err => {
							handle.stop();
							handle.emit('error', err);
						});
				})));
			}
		}

		for (const dir of handle.unwatchers.keys()) {
			if (dir !== '__clearPathRescanTimer__' && !lookup[dir]) {
				handle.unwatchers.delete(dir);
			}
		}

		if (!lastPathInfo || (lastPathInfo.paths < pathInfo.paths || lastPathInfo.paths > pathInfo.paths)) {
			// need force a scan
			scanner.scan({ paths: pathInfo.paths, force: true, detectFn: isJDK, depth: 1 })
				.then(results => processJDKs(results, uuid, pathInfo.defaultPath))
				.then(results => {
					if (!jdks) {
						jdks = results;
						jdks.watch(evt => {
							handle.emit('results', opts.gawk ? results : results.toJS());
						});
						handle.emit('results', opts.gawk ? jdks : jdks.toJS());
					}
				})
				.catch(err => {
					handle.stop();
					handle.emit('error', err);
				});
		} else if (lastPathInfo.defaultPath !== pathInfo.defaultPath) {
			// only need to update the default jdk
			processJDKs(jdks._value, uuid, pathInfo.defaultPath);
		}

		lastPathInfo = pathInfo;

		if (process.platform === 'win32') {
			timer = setTimeout(() => getPathInfo(opts).then(rescan), pathRescanInterval);
		}
	}

	Promise.resolve()
		.then(() => getPathInfo(opts))
		.then(rescan)
		.catch(err => {
			handle.stop();
			handle.emit('error', err);
		});

	return handle;
}

/**
 * Determines if the specified directory contains a JDK and if so, returns the
 * JDK info.
 *
 * @param {String} dir - The directory to check.
 * @returns {Promise}
 */
function isJDK(dir) {
	return Promise.resolve()
		.then(() => new JDK(dir))
		.then(jdk => jdk.init())
		.catch(err => Promise.resolve());
}

/**
 * Processes the array of discovered JDKs. It sorts the JDKs by version, selects
 * which JDK is the "default", and stores the new result in the cache.
 *
 * @param {Array<JDK>} list - An array containing zero or more JDK objects.
 * @param {String} uuid - Used to cache results.
 * @param {String} [defaultPath] - The path to select as the default.
 * @returns {Promise} Resolves a GawkArray containing the JDKs.
 */
function processJDKs(list, uuid, defaultPath) {
	let cachedValue = cache[uuid];
	let foundDefault = false;

	list.sort((a, b) => {
		let r = appc.version.compare(a.get('version').toJS(), b.get('version').toJS());
		if (r !== 0) {
			return r;
		}

		r = (a.get('build').toJS() || 0) - (b.get('build').toJS() || 0);
		if (r !== 0) {
			return r;
		}

		return a.get('architecture').toJS().localeCompare(b.get('architecture').toJS());
	});

	// loop over all of the new JDKs and set default version and copy the gawk
	// watchers
	for (const jdk of list) {
		if (defaultPath && jdk.get('path').toJS() === defaultPath) {
			jdk.set('default', true);
			foundDefault = true;
		} else {
			jdk.set('default', false);
		}

		// since we're going to overwrite the cached GawkArray with a new one,
		// we need to copy over the watchers for existing watched GawkObjects
		if (cachedValue) {
			for (const cachedJDK of cachedValue._value) {
				if (cachedJDK.get('version') === jdk.get('version') && cachedJDK.get('build') === jdk.get('build')) {
					jdk._watchers = cachedJDK._watchers;
					break;
				}
			}
		}
	}

	// no javac found the system path, so just select the last one as the default
	if (!foundDefault && list.length) {
		// pick the newest
		list[list.length-1].set('default', true);
	}

	// if we don't have a destination GawkArray for these results, create and
	// cache it
	if (!cachedValue) {
		cachedValue = cache[uuid] = new GawkArray;
	}

	// replace the internal array of the GawkArray and manually trigger the hash
	// to be regenerated and listeners to be notified
	cachedValue._value = list;
	cachedValue.notify();

	return cachedValue;
}

/**
 * Returns an array of search paths.
 *
 * @param {Object} [opts] - Various options.
 * @param {Boolean} [opts.ignorePlatformPaths=false] - When true, doesn't search
 * well known platform specific paths.
 * @param {Array} [opts.paths] - One or more paths to known JDKs.
 * @returns {Promise} Resolves array of paths.
 */
function getPathInfo(opts) {
	return Promise.resolve()
		.then(() => {
			if (opts.ignorePlatformPaths) {
				return [];
			}

			if (process.platform === 'linux') {
				return Promise.resolve({
					paths: ['/usr/lib/jvm']
				});
			}

			if (process.platform === 'darwin') {
				return Promise.resolve({
					paths: [
						'/Library/Java/JavaVirtualMachines',
						'/System/Library/Java/JavaVirtualMachines'
					]
				});
			}

			if (process.platform === 'win32') {
				const results = {};
				const scanRegistry = key => {
					// try to get the current version, but if this fails, no biggie
					return appc.windows.registry.get('HKLM', key, 'CurrentVersion')
						.then(currentVersion => currentVersion && `${key}\\${currentVersion}`)
						.catch(err => Promise.resolve())
						.then(defaultKey => {
							// get all subkeys which should only be valid JDKs
							return appc.windows.registry.keys('HKLM', key)
								.then(keys => Promise.all(keys.map(key => {
									return appc.windows.registry.get('HKLM', key, 'JavaHome')
										.then(javaHome => {
											if (javaHome && !results[javaHome]) {
												results[javaHome] = key === defaultKey;
											}
										})
										.catch(err => Promise.resolve());
								})));
						})
						.catch(err => Promise.resolve());
				};

				return Promise
					.all([
						scanRegistry('\\Software\\JavaSoft\\Java Development Kit'),
						scanRegistry('\\Software\\Wow6432Node\\JavaSoft\\Java Development Kit')
					])
					.then(() => ({
						paths: Object.keys(results),
						defaultPath: Object.keys(results).filter(key => results[key])[0]
					}));
			}

			return [];
		})
		.then(platformPaths => {
			let defaultPath = platformPaths.defaultPath;
			return Promise.resolve()
				.then(() => {
					if (!defaultPath) {
						return appc.subprocess.which('javac' + appc.subprocess.exe)
							.then(javac => (defaultPath = path.dirname(path.dirname(javac))))
							.catch(err => Promise.resolve());
					}
				})
				.then(() => appc.detect.getPaths({
					env: 'JAVA_HOME',
					paths: (platformPaths.paths || []).concat(opts.paths, defaultPath).filter(p => p)
				}))
				.then(paths => ({ paths, defaultPath }));
		});
}
