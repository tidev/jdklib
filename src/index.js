import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import which from 'which';
import 'source-map-support/register';

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
	return path.resolve(
		dir.replace(homeRegExp, (match, tilde, dir) => {
			return process.env[isWindows ? 'USERPROFILE' : 'HOME'] + (dir || path.sep);
		}).replace(winEnvVarRegExp, (match, token, name) => {
			return isWindows && process.env[name] || token;
		})
	);
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
 * Runs a specified command and returns the result.
 *
 * @param {String} cmd - The command to run.
 * @param {Array} [args] - An array of arguments to pass into the command.
 * @returns {Promise}
 */
function run(cmd, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args);
		let stdout = '';
		let stderr = '';

		child.stdout.on('data', data => {
			stdout += data.toString();
		});

		child.stderr.on('data', data => {
			stderr += data.toString();
		});

		child.on('close', code => resolve({ code, stdout, stderr }));
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
	// if there's no libjvm, then it's not a JDK
	const libjvms = libjvmLocations[process.platform];
	if (!libjvms || !libjvms.some(p => existsSync(path.resolve(dir, p)))) {
		// no libjvm, not a JDK
		return Promise.resolve();
	}

	let jdkInfo = {
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
		// missing key executables, not a JDK
		return Promise.resolve();
	}

	// try the 64-bit version first
	return run(jdkInfo.executables.javac, ['-version', '-d64'])
		.then(({ code, stdout, stderr }) => {
			if (!code) {
				// 64-bit version
				return { output: stderr, arch: '64bit' };
			}

			// try the 32-bit version
			return run(jdkInfo.executables.javac, ['-version'])
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
		.then(() => jdkInfo);
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
			run('/usr/libexec/java_home')
				.then((code, stdout, stderr) => {
					if (!code) {
						jdkPaths[stdout.trim()] = 1;
					}
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

	return Promise
		.all([
			searchWindowsRegistry('\\Software\\JavaSoft\\Java Development Kit'),
			searchWindowsRegistry('\\Software\\Wow6432Node\\JavaSoft\\Java Development Kit')
		])
		.then(paths => paths.filter(p => p));
}
