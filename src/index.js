import _ from 'lodash';
import appc from 'node-appc';
import { EventEmitter } from 'events';
import fs from 'fs';
import { GawkObject } from 'gawk';
import path from 'path';
import 'source-map-support/register';

const exe = appc.subprocess.exe;

/**
 * A list of requird executables used to determine if a directory is a JDK.
 * @type {Array}
 */
const requiredExecutables = ['java' + exe, 'javac' + exe, 'keytool' + exe, 'jarsigner' + exe];

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
 * An object containing the results.
 * @type {GawkObject}
 */
let results = null;

/**
 * An sorted array of resolved paths from the last time detection was performed.
 * If the jdkPaths changes between detect calls, then we need to re-detect.
 * @type {Array}
 */
let jdkPaths = null;

/**
 * A list of all static paths to check for a JDK. Static paths are those that
 * are derived from the system PATH which cannot change once the app starts.
 * @type {Array}
 */
let staticJDKPaths = null;

/**
 * Detects installed JDKs.
 *
 * @param {Object} [opts] - An object with various params.
 * @param {Boolean} [opts.ignorePlatformPaths=false] - When true, doesn't search
 * well known platform specific paths.
 * @param {Array} [opts.jdkPaths] - One or more paths to known JDKs.
 * @param {Boolan} [opts.gawk] - If true, returns the raw internal Gawk object,
 * otherwise returns a JavaScript object.
 * @returns {Promise}
 */
export function detect(opts = {}) {
	return Promise.resolve()
		.then(() => getJDKPaths(opts.jdkPaths, opts.ignorePlatformPaths))
		.then(paths => {
			if (opts.force || results === null || jdkPaths === null || (jdkPaths < paths || jdkPaths > paths)) {
				jdkPaths = paths;
				return doDetect(paths);
			}
		})
		.then(() => opts.gawk ? results : results.toJS());
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
class Watcher extends EventEmitter {
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
 * Detects installed JDKs and watches for changes.
 *
 * @param {Object} [opts] - An object with various params.
 * @param {Boolean} [opts.ignorePlatformPaths=false] - When true, doesn't search
 * well known platform specific paths.
 * @param {Array} [opts.jdkPaths] - One or more paths to known JDKs.
 * @param {Boolan} [opts.gawk] - If true, returns the raw internal Gawk object,
 * otherwise returns a JavaScript object.
 * @returns {Promise}
 */
export function watch(opts = {}) {
	const handle = new Watcher;
	let paths;

	Promise.resolve()
		.then(() => getJDKPaths(opts.jdkPaths, opts.ignorePlatformPaths))
		.then(p => {
			paths = p;
			if (opts.force || results === null || jdkPaths === null || (jdkPaths < paths || jdkPaths > paths)) {
				jdkPaths = paths;
				return doDetect(paths);
			}
		})
		.then(() => {
			for (const dir of paths) {
				handle.unwatchers.push(appc.fs.watch(dir, _.debounce(evt => {
					doDetect(paths)
						.then(() => handle.emit('results', opts.gawk ? results : results.toJS()));
				})));
			}

			handle.emit('results', opts.gawk ? results : results.toJS());
		})
		.catch(err => {
			handle.stop();
			handle.emit('error', err);
		});

	return handle;
}

/**
 * Checks one or more paths for a JDK.
 *
 * @param {Array} paths - One or more paths to check.
 * @returns {Promise}
 */
function doDetect(paths) {
	const jdks = [];

	if (results === null) {
		results = new GawkObject;
	}

	return Promise
		.all(paths.map(dir => appc.util.mutex(dir, () => new Promise((resolve, reject) => {
			Promise.resolve()
				.then(() => {
					return new Promise((resolve, reject) => {
						if (!appc.fs.existsSync(dir)) {
							return resolve();
						}

						isJDK(dir)
							.then(jdk => jdk || Promise.all(fs.readdirSync(dir).map(name => isJDK(path.join(dir, name)))))
							.then(resolve);
					});
				})
				.then(found => {
					if (!Array.isArray(found)) {
						found = [found];
					}
					for (const jdk of found) {
						jdk && jdks.push(jdk);
					}
				})
				.then(resolve)
				.catch(resolve);
		}))))
		.then(() => {
			const deleted = results.keys();

			for (const jdk of jdks) {
				const key = jdk.version + '_' + jdk.build;
				delete deleted[key];
			}

			for (const key of deleted) {
				results.delete(key);
			}

			for (const jdk of jdks) {
				const key = jdk.version + '_' + jdk.build;
				if (results.has(key)) {
					results.get(key).mergeDeep(jdk);
				} else {
					results.set(key, jdk);
				}
			}

			return results;
		});
}

/**
 * Determines if the specified directory contains a JDK and if so, returns the
 * JDK info.
 *
 * @param {String} dir - The directory to check.
 * @returns {Promise}
 */
function isJDK(dir) {
	// on OS X, the JDK lives in Contents/Home
	if (process.platform === 'darwin') {
		const p = path.join(dir, 'Contents', 'Home');
		if (appc.fs.existsSync(p)) {
			dir = p;
		}
	}

	const libjvms = libjvmLocations[process.platform];
	if (!libjvms || !libjvms.some(p => appc.fs.existsSync(path.resolve(dir, p)))) {
		// if there's no libjvm, then it's not a JDK
		return Promise.resolve();
	}

	let jdkInfo = {
		path: dir,
		version: null,
		build: null,
		architecture: null,
		executables: {}
	};

	if (!requiredExecutables.every(cmd => {
		var p = path.join(dir, 'bin', cmd);
		if (appc.fs.existsSync(p)) {
			jdkInfo.executables[cmd] = fs.realpathSync(p);
			return true;
		}
	})) {
		// missing key executables, not a JDK
		return Promise.resolve();
	}

	return Promise.resolve()
		.then(() => {
			// try the 64-bit version first
			return appc.subprocess.run(jdkInfo.executables.javac, ['-version', '-d64'])
				.then(({ code, stdout, stderr }) => {
					// 64-bit version
					return { output: stderr, arch: '64bit' };
				});
		})
		.catch(err => {
			// try the 32-bit version
			return appc.subprocess.run(jdkInfo.executables.javac, ['-version'])
				.then(({ code, stdout, stderr }) => {
					return code ? null : { output: stderr, arch: '32bit' };
				});
		})
		.then(details => {
			if (details) {
				const m = details.output.match(/javac (.+)_(.+)/);
				jdkInfo.version = m[1];
				jdkInfo.build = m[2];
				jdkInfo.architecture = details.arch;
			} else {
				jdkInfo = null;
			}
		})
		.then(() => jdkInfo)
		.catch(err => Promise.resolve());
}

/**
 * Populates the list of static JDK paths based on the JAVA_HOME and system PATH
 * environment variables. These are static because they cannot change once the
 * app is started.
 */
function getStaticJDKPaths() {
	staticJDKPaths = [];

	return Promise
		.all([
			appc.subprocess.which('javac')
				.then(file => {
					const path = path.dirname(path.dirname(fs.realpathSync(file)));
					if (!staticJDKPaths.includes(path)) {
						staticJDKPaths.push(path);
					}
				})
				.catch(() => Promise.resolve()),

			new Promise((resolve, reject) => {
				const javaHome = process.env.JAVA_HOME;
				if (!javaHome) {
					return resolve();
				}

				fs.stat(javaHome, (err, stat) => {
					if (err || !stat.isDirectory()) {
						return resolve();
					}

					fs.realpath(javaHome, (err, path) => {
						if (!err) {
							if (!staticJDKPaths.includes(path)) {
								staticJDKPaths.push(path);
							}
						}
						resolve();
					});
				});
			})
		]);
}

/**
 * Retrieves an array of platform specific paths to search.
 *
 * @param {Array} jdkPaths - An array containing paths to search for JDKs.
 * @param {Boolean} [opts.ignorePlatformPaths=false] - When true, doesn't search
 * well known platform specific paths.
 * @returns {Promise}
 */
function getJDKPaths(jdkPaths, ignorePlatformPaths) {
	const paths = [];

	return Promise.resolve()
		.then(() => {
			if (!ignorePlatformPaths) {
				return Promise.resolve()
					// 1. first get the static paths
					.then(() => {
						if (!staticJDKPaths) {
							return getStaticJDKPaths();
						}
					})
					.then(() => {
						paths.push.apply(paths, staticJDKPaths);
					})

					// 2. add the platform specific paths
					.then(() => {
						if (!ignorePlatformPaths) {
							switch (process.platform) {
								case 'linux':  return findLinuxSearchPaths();
								case 'darwin': return findDarwinSearchPaths();
								case 'win32':  return findWindowsSearchPaths();
							}
						}
						return [];
					})
					.then(platformPaths => paths.push.apply(paths, platformPaths));
			}
		})

		// 3. add the jdk paths that were passed in
		.then(() => {
			if (jdkPaths && !Array.isArray(jdkPaths)) {
				throw new TypeError('Expected jdkPaths to be an array of strings');
			} else if (!jdkPaths || jdkPaths.length === 0) {
				return;
			}

			return Promise
				.all(jdkPaths.map(p => new Promise((resolve, reject) => {
					if (typeof p !== 'string' || !p) {
						return reject(new Error('Invalid path in jdkPaths: ' + p));
					}

					fs.stat(p, (err, stat) => {
						if (err) {
							// path does not exist, but maybe it will
							return resolve(p);
						}

						if (!stat.isDirectory()) {
							// path doesn't exist or not a directory, move along
							return resolve();
						}

						// path exists, get the real path before we add it
						fs.realpath(p, (err, dir) => resolve(err ? null : dir));
					});
				})))
				.then(jdkPaths => paths.push.apply(paths, jdkPaths));
		})

		// 4. clean up the list of paths
		.then(() => appc.util.unique(paths).sort());
}

/**
 * Returns an array of well known JDK paths on Linux.
 *
 * @returns {Promise}
 */
function findLinuxSearchPaths() {
	return Promise.resolve([
		'/usr/lib/jvm'
	]);
}

/**
* Returns an array of well known JDK paths on OS X.
 *
 * @returns {Promise}
 */
function findDarwinSearchPaths() {
	return Promise.resolve([
		'/Library/Java/JavaVirtualMachines',
		'/System/Library/Java/JavaVirtualMachines'
	]);
}

/**
 * Returns an array of well known JDK paths on Windows.
 *
 * @returns {Promise}
 */
function findWindowsSearchPaths() {
	const Winreg = require('winreg');

	function searchWindowsRegistry(key) {
		return new Promise((resolve, reject) => {
			new Winreg({ hive: Winreg.HKLM, key })
				.get('CurrentVersion', function (err, item) {
					const currentVersion = !err && item.value;
					if (!currentVersion) {
						return resolve();
					}

					new Winreg({ hive: Winreg.HKLM, key: key + '\\' + currentVersion })
						.get('JavaHome', function (err, item) {
							if (!err && item.value) {
								resolve(item.value);
							} else {
								resolve();
							}
						});
				});
		});
	}

	return Promise.all([
		searchWindowsRegistry('\\Software\\JavaSoft\\Java Development Kit'),
		searchWindowsRegistry('\\Software\\Wow6432Node\\JavaSoft\\Java Development Kit')
	]);
}
