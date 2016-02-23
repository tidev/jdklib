import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import which from 'which';

const isWindows = process.platform == 'win32';
const homeRegExp = /^(~)([\\/].*)?$/;
const winEnvVarRegExp = /(%([^%]*)%)/g;
const exe = isWindows ? '.exe' : '';
const executables = ['java', 'javac', 'keytool', 'jarsigner'];
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

let cache = null;

/**
 * Detects installed JDKs.
 *
 * @param {Object} [opts] - An object with various params.
 * @param {Boolean} [opts.bypassCache=false] - When true, forces scan for all JDKs.
 * @param {String} [opts.javaHome] - Path to a known Java home.
 * @returns {Promise}
 */
export function detect(opts = {}) {
	if (cache && !opts.bypassCache) {
		return Promise.resolve(cache);
	}

	const results = cache = {
		jdks: {}
	};

	// check the java home
	let home = opts.javaHome || process.env.JAVA_HOME || null;
	if (home) {
		home = resolveDir(home);
		if (!existsSync(home)) {
			home = null;
		}
	}
	results.home = home;

	return Promise.resolve()
		.then(detectJDKPaths)
		.then(jdkPaths => {
			// add the java home to the array of paths to check
			if (home && jdkPaths.indexOf(home) === -1) {
				jdkPaths.unshift(home);
			}

			return Promise.all(jdkPaths.map(p => {
				return isJDK(p)
					.then(jdkInfo => {
						if (jdkInfo) {
							results.jdks[jdkInfo.version + '_' + jdkInfo.build] = jdkInfo;
						}
					});
			}));
		})
		.then(() => results);
}

function existsSync(it) {
	try {
		fs.accessSync(it);
		return true;
	} catch (e) {
		return false;
	}
}

/**
 * Resolves the specified directory.
 *
 * @param {String} dir - The directory path to resolve.
 * @returns {String}
 */
function resolveDir(dir) {
	return path.resolve(dir)
		.replace(homeRegExp, (match, tilde, dir) => {
			return process.env[isWindows ? 'USERPROFILE' : 'HOME'] + (dir || path.sep);
		})
		.replace(winEnvVarRegExp, (match, token, name) => {
			return isWindows && process.env[name] || token;
		});
}

/**
 * Wraps `which()` with a promise.
 *
 * @param {String} executable - The executable to find.
 * @returns {Promise}
 */
function findExecutable(executable) {
	return new Promise((resolve, reject) => {
		which(executable, function (err, file) {
			if (err) {
				reject(err);
			} else {
				resolve(file);
			}
		});
	});
}

/**
 * Determins if the specified directory contains a JDK and if so, returns the
 * JDK info.
 *
 * @param {String} dir - The directory to check.
 * @returns {Promise}
 */
function isJDK(dir) {
	return new Promise((resolve, reject) => {
		// if there's no libjvm, then it's not a JDK
		const libjvms = libjvmLocations[process.platform];
		if (!libjvms || !libjvms.some(p => existsSync(path.resolve(dir, p)))) {
			return resolve();
		}

		const jdkInfo = {
			path: dir,
			version: null,
			build: null,
			architecture: null,
			executables: {}
		};

		if (!executables.every(cmd => {
			var p = path.join(dir, 'bin', cmd + exe);
			if (existsSync(p)) {
				jdkInfo.executables[cmd] = fs.realpathSync(p);
				return true;
			}
		})) {
			return resolve();
		}

		// try the 64-bit version first
		exec(jdkInfo.executables.javac + ' -version -d64', (err, stdout, stderr) => {
			if (err) {
				// try the 32-bit version
				exec(jdkInfo.executables.javac + ' -version', (err, stdout, stderr) => {
					finalize(err ? null : stderr, '32bit');
				});
			} else {
				// 64-bit version
				finalize(stderr, '64bit');
			}
		});

		function finalize(str, arch) {
			var m = str !== null && str.match(/javac (.+)_(.+)/);
			if (m) {
				jdkInfo.version = m[1];
				jdkInfo.build = m[2];
				jdkInfo.architecture = arch;
				resolve(jdkInfo);
			} else {
				resolve();
			}
		}
	});
}

/**
 * Runs platform specific JDK scanning.
 *
 * @returns {Promise}
 */
function detectJDKPaths() {
	switch (process.platform) {
		case 'linux':
			return findJDKsLinux();
		case 'darwin':
			return findJDKsDarwin();
		case 'win32':
			return findJDKsWin32();
	}
	return Promise.resolve([]);
}

/**
 * Scans paths for installed JDKs.
 *
 * @returns {Promise}
 */
function findJDKsLinux() {
	return findExecutable('javac')
		.then(file => [ path.dirname(path.dirname(file)) ]);
}

/**
 * Scans paths for installed JDKs.
 *
 * @returns {Promise}
 */
function findJDKsDarwin() {
	const jdkPaths = {};

	['/Library/Java/JavaVirtualMachines', '/System/Library/Java/JavaVirtualMachines'].forEach(parent => {
		existsSync(parent) && fs.readdirSync(parent).forEach(name => {
			jdkPaths[path.join(parent, name, 'Contents', 'Home')] = 1;
		});
	});

	return Promise
		.all([
			new Promise((resolve, reject) => {
				exec('/usr/libexec/java_home', (err, stdout) => {
					if (!err) {
						jdkPaths[stdout.trim()] = 1;
					}
					resolve();
				});
			}),

			findExecutable('javac')
				.then(file => jdkPaths[path.dirname(path.dirname(file))] = 1)
		])
		.then(() => Object.keys(jdkPaths));
}

/**
 * Scans paths for installed JDKs.
 *
 * @returns {Promise}
 */
function findJDKsWin32() {
	const jdkPaths = {};

	return Promise
		.all(
			['%SystemDrive%', '%ProgramFiles%', '%ProgramFiles(x86)%', '%ProgramW6432%', '~']
				.map(dir => resolveDir(dir))
				.map(dir => {
					return new Promise((resolve, reject) => {
						dir = resolveDir(dir);
						if (existsSync(dir)) {
							fs.readdirSync(dir).forEach(name => jdkPaths[path.join(dir, name)] = 1);
						}
						resolve();
					});
				})
		)
		.then(() => Object.keys(jdkPaths));
}
