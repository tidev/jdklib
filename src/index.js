import _ from 'lodash';
import appc from 'node-appc';
import fs from 'fs';
import path from 'path';

if (!Error.prepareStackTrace) {
	require('source-map-support/register');
}

/**
 * Common JDK install locations.
 * @type {Object}
 */
const platformPaths = {
	darwin: [
		'/Library/Java/JavaVirtualMachines',
		'/System/Library/Java/JavaVirtualMachines'
	],
	linux: [
		'/usr/lib/jvm'
	]
	// note: for Windows, we check the Windows Registry
};

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
 * The detection engine instance.
 * @type {Engine}
 */
const engine = new appc.detect.Engine({
	checkDir:       checkDir,
	depth:          1,
	env:            'JAVA_HOME',
	exe:            `javac${appc.subprocess.exe}`,
	multiple:       true,
	processResults: processResults,
	registryKeys:   scanRegistry,
	paths:          platformPaths[process.platform]
});

/**
 * Resets the internal detection result cache. This is intended for testing
 * purposes.
 */
export function resetCache() {
	engine.cache = {};
}

/**
 * JDK information object.
 */
export class JDK extends appc.gawk.GawkObject {
	constructor(dir) {
		if (typeof dir !== 'string' || !dir) {
			throw new TypeError('Expected directory to be a valid string');
		}

		dir = appc.path.expand(dir);
		if (!appc.fs.isDir(dir)) {
			throw new Error('Directory does not exist');
		}

		// on OS X, the JDK lives in Contents/Home
		if (process.platform === 'darwin') {
			const p = path.join(dir, 'Contents', 'Home');
			if (appc.fs.isDir(p)) {
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
			if (appc.fs.isFile(p)) {
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
 * @param {Boolean} [opts.force=false] - When true, bypasses cache and
 * re-detects the JDKs.
 * @param {Boolan} [opts.gawk=false] - If true, returns the raw internal
 * `GawkArray`, otherwise returns a JavaScript array.
 * @param {Array} [opts.paths] - One or more paths to known JDKs.
 * @returns {Promise} Resolves an object or GawkObject containing the values.
 */
export function detect(opts = {}) {
	return new Promise((resolve, reject) => {
		engine
			.detect(opts)
			.on('results', resolve)
			.on('error', reject);
	});
}

/**
 * Detects installed JDKs and watches for changes.
 *
 * @param {Object} [opts] - An object with various params.
 * @param {Boolean} [opts.force=false] - When true, bypasses cache and
 * re-detects the JDKs.
 * @param {Boolan} [opts.gawk=false] - If true, returns the raw internal
 * `GawkArray`, otherwise returns a JavaScript array.
 * @param {Array} [opts.paths] - One or more paths to known JDKs.
 * @returns {WatchHandle}
 */
export function watch(opts = {}) {
	opts.watch = true;
	return engine
		.detect(opts);
}

/**
 * Determines if the specified directory contains a JDK and if so, returns the
 * JDK info.
 *
 * @param {String} dir - The directory to check.
 * @returns {Promise}
 */
function checkDir(dir) {
	return Promise.resolve()
		.then(() => new JDK(dir).init())
		.catch(err => Promise.resolve());
}

/**
 * Sorts the results and assigns a default.
 *
 * @param {Array} results - An array of results.
 * @param {*} previousValue - The previous value or `undefined` if there is no
 * previous value.
 * @param {Engine} engine - The detect engine instance.
 */
function processResults(results, previousValue, engine) {
	let foundDefault = false;

	if (results.length > 1) {
		results.sort((a, b) => {
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
	}

	// loop over all of the new JDKs and set default version and copy the gawk
	// watchers
	for (const jdk of results) {
		if (engine.defaultPath && jdk.get('path').toJS() === engine.defaultPath) {
			jdk.set('default', true);
			foundDefault = true;
		} else {
			jdk.set('default', false);
		}

		// since we're going to overwrite the cached GawkArray with a new one,
		// we need to copy over the watchers for existing watched GawkObjects
		if (previousValue instanceof appc.gawk.GawkObject) {
			for (const cachedJDK of previousValue._value) {
				if (cachedJDK.get('version') === jdk.get('version') && cachedJDK.get('build') === jdk.get('build')) {
					jdk._watchers = cachedJDK._watchers;
					break;
				}
			}
		}
	}

	// no javac found the system path, so just select the last one as the default
	if (!foundDefault && results.length) {
		// pick the newest
		results[results.length-1].set('default', true);
	}
}

/**
 * Scans the Windows Registry for JDK paths to search.
 *
 * @returns {Promise} Resolves object containing an array of paths and a default
 * path.
 */
function scanRegistry() {
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
