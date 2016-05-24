import _ from 'lodash';
import appc from 'node-appc';
import { EventEmitter } from 'events';
import fs from 'fs';
import { GawkArray, GawkObject } from 'gawk';
import path from 'path';
import 'source-map-support/register';

/**
 * A list of requird executables used to determine if a directory is a JDK.
 * @type {Array}
 */
const requiredExecutables = ['java', 'javac', 'keytool', 'jarsigner'];

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
 * A map of the hash of the JDK paths to the resulting GawkArray.
 * @type {Object}
 */
const cache = {};

/**
 * Resets the internal detection result cache. This is primarily for testing
 * purposes.
 */
export function resetCache() {
	for (const key of Object.keys(cache)) {
		delete cache[key];
	}
	appc.detect.resetCache();
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

		if (!requiredExecutables.every(cmd => {
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
 * A handle returned when calling `watch()`. This object exposes a `stop()`
 * method to unwatch all paths specified in the `jdkPaths` parameter.
 *
 * This is not a public class. It should only be instantiated by the `watch()`
 * method.
 *
 * @emits {results} Emits the detection results.
 * @emits {error} Emitted when an error occurs.
 */
export class Watcher extends EventEmitter {
	/**
	 * Initializes the Watcher instance.
	 */
	constructor() {
		super();
		this.unwatchers = [];
	}

	/**
	 * Stops all active watchers associated with this handle.
	 */
	stop() {
		let unwatch;
		while (unwatch = this.unwatchers.shift()) {
			unwatch();
		}
	}
}

/**
 * Detects installed JDKs.
 *
 * @param {Object} [opts] - An object with various params.
 * @param {Boolean} [opts.ignorePlatformPaths=false] - When true, doesn't search
 * well known platform specific paths.
 * @param {Array} [opts.paths] - One or more paths to known JDKs.
 * @param {Boolan} [opts.gawk] - If true, returns the raw internal Gawk object,
 * otherwise returns a JavaScript object.
 * @returns {Promise}
 */
export function detect(opts = {}) {
	return Promise.resolve()
		.then(() => opts.ignorePlatformPaths ? [] : getPlatformPaths())
		.then(platformPaths => appc.detect.getPaths({
			env: 'JAVA_HOME',
			executable: 'javac' + appc.subprocess.exe,
			paths: platformPaths.concat(opts.paths).filter(p => p)
		}))
		.then(paths => {
			return appc.detect.scan({ paths, force: opts.force, detectFn: isJDK, depth: 1 })
				.then(results => processJDKs(results, paths));
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
 * @param {Boolan} [opts.gawk] - If true, returns the raw internal Gawk object,
 * otherwise returns a JavaScript object.
 * @returns {Promise}
 */
export function watch(opts = {}) {
	const handle = new Watcher;

	Promise.resolve()
		.then(() => opts.ignorePlatformPaths ? [] : getPlatformPaths())
		.then(platformPaths => appc.detect.getPaths({
			env: 'JAVA_HOME',
			executable: 'javac' + appc.subprocess.exe,
			paths: platformPaths.concat(opts.paths).filter(p => p)
		}))
		.then(paths => {
			return appc.detect.scan({ paths, force: opts.force, detectFn: isJDK, depth: 1 })
				.then(results => processJDKs(results, paths))
				.then(results => {
					results.watch(evt => {
						handle.emit('results', opts.gawk ? results : results.toJS());
					});

					for (const dir of paths) {
						handle.unwatchers.push(appc.fs.watch(dir, _.debounce(evt => {
							appc.detect.scan({ paths: [dir], force: true, detectFn: isJDK, depth: 1 })
								.then(results => processJDKs(results, paths))
								.catch(err => {
									handle.stop();
									handle.emit('error', err);
								});
						})));
					}

					handle.emit('results', opts.gawk ? results : results.toJS());
				});
		})
		.catch(err => {
			handle.stop();
			handle.emit('error', err);
		});

	return handle;
}

/**
 * Processes the array of discovered JDKs. It sorts the JDKs by version, selects
 * which JDK is the "default", and stores the new result in the cache.
 *
 * @param {Array<JDK>} jdks - An array containing zero or more JDK objects.
 * @param {Array<String>} paths - The list of paths scanned to find the JDKs.
 * @returns {GawkArray}
 */
function processJDKs(jdks, paths) {
	// build a list of paths so that we can quickly check if a specific JDK is
	// the one containing javac from the system path
	const systemPaths = {};
	for (let p of process.env.PATH.split(path.delimiter)) {
		try {
			if (p = fs.realpathSync(p)) {
				systemPaths[p] = 1;
			}
		} catch (e) {
			// squeltch
		}
	}

	const hash = appc.util.sha1(JSON.stringify(paths));
	let cachedValue = cache[hash];

	let foundDefault = false;

	// sort the JDKs
	jdks.sort((a, b) => {
		const r = appc.version.compare(a.get('version').toJS(), b.get('version').toJS());
		const b1 = a.get('build').toJS();
		const b2 = b.get('build').toJS();
		return r !== 0 ? r : (b1 > b2 ? -1 : b1 < b2 ? 1 : 0);
	});

	// loop over all of the new JDKs and set default version and copy the gawk
	// watchers
	for (const jdk of jdks) {
		if (!foundDefault) {
			// test if this JDK is the one in the system path
			const javac = jdk.get(['executables', 'javac']);
			if (javac && systemPaths[path.dirname(javac)]) {
				jdk.set('default', true);
				foundDefault = true;
				if (!cachedValue) {
					// no point and going on if there isn't a cached
					break;
				}
			}
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
	if (!foundDefault && jdks.length) {
		// pick the newest
		jdks[jdks.length-1].set('default', true);
	}

	// if we don't have a destination GawkArray for these results, create and
	// cache it
	if (!cache[hash]) {
		cachedValue = cache[hash] = new GawkArray;
	}

	// replace the internal array of the GawkArray and manually trigger the hash
	// to be regenerated and listeners to be notified
	cachedValue._value = jdks;
	cachedValue.notify();

	return cachedValue;
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
 * Returns platform specific search paths.
 *
 * @returns {Promise}
 */
function getPlatformPaths() {
	if (process.platform === 'linux') {
		return Promise.resolve([
			'/usr/lib/jvm'
		]);
	}

	if (process.platform === 'darwin') {
		return Promise.resolve([
			'/Library/Java/JavaVirtualMachines',
			'/System/Library/Java/JavaVirtualMachines'
		]);
	}

	if (process.platform === 'win32') {
		const Winreg = require('winreg');

		const searchWindowsRegistry = key => {
			return new Promise((resolve, reject) => {
				new Winreg({ hive: Winreg.HKLM, key })
					.get('CurrentVersion', (err, item) => {
						const currentVersion = !err && item.value;
						if (!currentVersion) {
							return resolve();
						}

						new Winreg({ hive: Winreg.HKLM, key: key + '\\' + currentVersion })
							.get('JavaHome', (err, item) => {
								if (!err && item.value) {
									resolve(item.value);
								} else {
									resolve();
								}
							});
					});
			});
		};

		return Promise.all([
			searchWindowsRegistry('\\Software\\JavaSoft\\Java Development Kit'),
			searchWindowsRegistry('\\Software\\Wow6432Node\\JavaSoft\\Java Development Kit')
		]);
	}
}
