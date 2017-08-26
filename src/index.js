/* istanbul ignore if */
if (!Error.prepareStackTrace) {
	require('source-map-support/register');
}

import fs from 'fs';
import path from 'path';
import snooplogg from 'snooplogg';

import { isDir, isFile } from 'appcd-fs';
import { expandPath, real } from 'appcd-path';
import { exe, run } from 'appcd-subprocess';

const { log, error } = snooplogg.config({ theme: 'detailed' })('jdklib');
const { highlight } = snooplogg.styles;

/**
 * Common JDK install locations.
 * @type {Object}
 */
export const jdkLocations = {
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
export const libjvmLocations = {
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
 * JDK information object.
 */
export default class JDK {
	/**
	 * Performs some simple tests to check if the specified directory is a JDK or not, then
	 * initializes the JDK info.
	 *
	 * @param {String} dir - The directory to scan.
	 * @access public
	 */
	constructor(dir) {
		if (typeof dir !== 'string' || !dir) {
			error('Directory is not a valid string');
			throw new TypeError('Expected directory to be a valid string');
		}

		dir = expandPath(dir);
		if (!isDir(dir)) {
			error('Directory does not exist: %s', highlight(dir));
			throw new Error('Directory does not exist');
		}

		// on OS X, the JDK lives in Contents/Home
		if (process.platform === 'darwin') {
			const p = path.join(dir, 'Contents', 'Home');
			if (isDir(p)) {
				dir = p;
			}
		}

		const libjvms = libjvmLocations[process.platform];
		if (!libjvms || !libjvms.some(p => isFile(path.resolve(dir, p)))) {
			error('Directory missing JVM library: %s', dir);
			throw new Error('Directory missing JVM library');
		}

		this.arch        = null;
		this.build       = null;
		this.executables = {};
		this.path        = dir;
		this.version     = null;

		if (!['java', 'javac', 'keytool', 'jarsigner'].every(cmd => {
			const p = path.join(dir, 'bin', cmd + exe);
			if (isFile(p)) {
				this.executables[cmd] = real(p);
				return true;
			}
		})) {
			error('Directory missing required program: %s', dir);
			throw new Error('Directory missing required program');
		}

		log('Found a JDK, but need to init: %s', highlight(dir));
	}

	/**
	 * Fetches the JDK version and architecture by running javac.
	 *
	 * @returns {Promise}
	 * @access public
	 */
	init() {
		const javac = this.executables.javac;
		if (!javac) {
			log('No javac found, skipping version detection');
			return Promise.resolve(this);
		}

		// try the 64-bit version first
		return run(javac, ['-d64', '-version'])
			.then(({ stdout, stderr }) => {
				// 64-bit version
				log('javac is the 64-bit version');
				return { output: stderr, arch: '64bit' };
			})
			.catch(err => {
				// if err.code === 2, then we have the 64-bit version, but we must re-run javac to
				// get the version since on Windows it doesn't print the version correctly
				log(`javac is the ${err.code === 2 ? 64 : 32}-bit version`);
				return run(javac, ['-version'])
					.then(({ stdout, stderr }) => {
						return { output: stderr, arch: err.code === 2 ? '64bit' : '32bit' };
					});
			})
			.then(({ output, arch }) => {
				const m = output.match(/javac (.+)_(.+)/);
				this.version = m && m[1] || null;
				this.build = m && parseInt(m[2]) || null;
				this.arch = arch;
				return this;
			})
			.catch(() => this);
	}
}

/**
 * Detects if the specified directory contains a JDK and if so, returns a `JDK` object.
 *
 * @param {String} dir - The directory to scan.
 * @returns {Promise}
 */
export async function detect(dir) {
	return await new JDK(dir).init();
}
