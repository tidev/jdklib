import _ from 'lodash';
import appc from 'node-appc';
import del from 'del';
import { expect } from 'chai';
import fs from 'fs-extra';
import { GawkArray } from 'gawk';
import * as jdklib from '../src/index';
import path from 'path';
import temp from 'temp';

const isWindows = /^win/.test(process.platform);

// in our tests, we need to wipe the PATH environment variable so that JDKs
// other than our mocks are found, but on Windows, we need to leave
// C:\Windows\System32 in the path so that we can query the Windows registry
const tempPATH = !isWindows ? '' : (function () {
	const windowsDir = appc.path.expand('%SystemRoot%');
	return process.env.PATH
		.split(path.delimiter)
		.filter(p => p.indexOf(windowsDir) === 0)
		.join(path.delimiter);
}());

temp.track();

function validateJDKs(results, versions) {
	expect(results).to.be.an.Array;

	for (const jdk of results) {
		if (Array.isArray(versions)) {
			expect(jdk.version + '_' + jdk.build).to.equal(versions.shift());
		}
		expect(jdk).to.be.an.Object;
		expect(jdk).to.have.keys('path', 'version', 'build', 'architecture', 'executables', 'default');
		expect(jdk.path).to.be.a.String;
		expect(jdk.path).to.not.equal('');
		expect(() => fs.statSync(jdk.path)).to.not.throw(Error);
		expect(jdk.version).to.be.a.String;
		expect(jdk.version).to.not.equal('');
		expect(jdk.build).to.be.a.String;
		expect(jdk.build).to.not.equal('');
		expect(jdk.architecture).to.be.a.String;
		expect(jdk.architecture).to.be.oneOf(['32bit', '64bit']);
		expect(jdk.executables).to.be.an.Object;
		for (const name of Object.keys(jdk.executables)) {
			expect(jdk.executables[name]).to.be.a.String;
			expect(jdk.executables[name]).to.not.equal('');
			expect(() => fs.statSync(jdk.executables[name])).to.not.throw(Error);
		}
	}
}

describe('detect()', () => {
	beforeEach(function () {
		this.JAVA_HOME = process.env.JAVA_HOME;
		this.PATH = process.env.PATH;
		process.env.JAVA_HOME = '';
		process.env.PATH = tempPATH;
	});

	afterEach(function () {
		process.env.JAVA_HOME = this.JAVA_HOME;
		process.env.PATH = this.PATH;
		jdklib.resetCache();
	});

	it('should detect JDK using defaults', function (done) {
		this.timeout(10000);
		this.slow(5000);

		jdklib
			.detect()
			.then(results => {
				validateJDKs(results);

				// one more time
				return jdklib
					.detect()
					.then(results => {
						validateJDKs(results);
						done();
					});
			})
			.catch(done);
	});

	it('should detect JDK using mock JDK', done => {
		jdklib
			.detect({
				force: true,
				ignorePlatformPaths: true,
				jdkPaths: [
					path.join(__dirname, 'mocks', 'jdk-1.8'),
					'/Users/chris/Desktop',
					'/Users/chris/doesnotexist'
				]
			})
			.then(results => {
				validateJDKs(results, ['1.8.0_92']);
				done();
			})
			.catch(done);
	});

	it('should detect JDK using mock JDKs', done => {
		jdklib
			.detect({
				force: true,
				ignorePlatformPaths: true,
				jdkPaths: [
					path.join(__dirname, 'mocks')
				]
			})
			.then(results => {
				validateJDKs(results, ['1.6.0_45', '1.7.0_80', '1.8.0_92', '1.8.0_92']);
				done();
			})
			.catch(done);
	});

	it('should not find any jdks in an empty directory', done => {
		jdklib
			.detect({
				force: true,
				ignorePlatformPaths: true,
				jdkPaths: [
					path.join(__dirname, 'mocks', 'empty')
				]
			})
			.then(results => {
				expect(results).to.be.an.Object;
				expect(Object.keys(results)).to.have.lengthOf(0);
				done();
			})
			.catch(done);
	});

	it('should not find any jdks in an incomplete jdk directory', done => {
		jdklib
			.detect({
				force: true,
				ignorePlatformPaths: true,
				jdkPaths: [
					path.join(__dirname, 'mocks', 'incomplete-jdk')
				]
			})
			.then(results => {
				expect(results).to.be.an.Object;
				expect(Object.keys(results)).to.have.lengthOf(0);
				done();
			})
			.catch(done);
	});

	it('should not find any jdks in a jdk directory with bad binaries', done => {
		jdklib
			.detect({
				force: true,
				ignorePlatformPaths: true,
				jdkPaths: [
					path.join(__dirname, 'mocks', 'bad-bin-jdk')
				]
			})
			.then(results => {
				expect(results).to.be.an.Object;
				expect(Object.keys(results)).to.have.lengthOf(0);
				done();
			})
			.catch(done);
	});

	it('should find a 32-bit jdk', done => {
		jdklib
			.detect({
				force: true,
				ignorePlatformPaths: true,
				jdkPaths: [
					path.join(__dirname, 'mocks', 'jdk-1.8-32bit')
				]
			})
			.then(results => {
				validateJDKs(results, ['1.8.0_92']);
				done();
			})
			.catch(done);
	});

	it('should find mock jdk via JAVA_HOME environment variable', done => {
		process.env.JAVA_HOME = path.join(__dirname, 'mocks', 'jdk-1.8');
		jdklib
			.detect({ force: true, ignorePlatformPaths: true })
			.then(results => {
				validateJDKs(results, ['1.8.0_92']);
				done();
			})
			.catch(done);
	});

	it('should not find a JDK when JAVA_HOME points to a file', done => {
		process.env.JAVA_HOME = __filename;
		jdklib
			.detect({ force: true, ignorePlatformPaths: true })
			.then(results => {
				expect(results).to.be.an.Array;
				expect(results).to.have.lengthOf(0);
				done();
			})
			.catch(done);
	});

	it('should find mock jdk via javac in the PATH', done => {
		process.env.PATH = path.join(__dirname, 'mocks', 'jdk-1.8', 'bin');
		jdklib
			.detect({ force: true, ignorePlatformPaths: true })
			.then(results => {
				validateJDKs(results, ['1.8.0_92']);
				done();
			})
			.catch(done);
	});

	it('should not find a JDK when jdkPaths is a file', done => {
		jdklib
			.detect({
				force: true,
				ignorePlatformPaths: true,
				jdkPaths: [
					__filename
				]
			})
			.then(results => {
				expect(results).to.be.an.Array;
				expect(results).to.have.lengthOf(0);
				done();
			})
			.catch(done);
	});

	it('should not re-detect after initial detect', done => {
		const tmp = temp.mkdirSync('jdklib-');
		const opts = {
			force: true,
			ignorePlatformPaths: true,
			jdkPaths: [
				path.join(__dirname, 'mocks', 'jdk-1.8'),
				tmp
			]
		};

		// run the initial detect
		jdklib
			.detect(opts)
			.then(results => {
				validateJDKs(results, ['1.8.0_92']);
			})
			.then(() => {
				// run detect again, but this time we do not force re-detect and
				// we copy JDK 1.7 into the tmp dir so that there should be 2
				// detected JDKs, but since we're not forcing, it's returning
				// the cached results
				opts.force = false;
				fs.copySync(path.join(__dirname, 'mocks', 'jdk-1.7'), tmp);
				return jdklib.detect(opts);
			})
			.then(results => {
				validateJDKs(results, ['1.8.0_92']);
			})
			.then(() => {
				// force re-detect again to find the JDK 1.7 we copied
				opts.force = true;
				return jdklib.detect(opts);
			})
			.then(results => {
				validateJDKs(results, ['1.7.0_80', '1.8.0_92']);
				done();
			})
			.catch(done);
	});

	it('should queue up detect calls', function (done) {
		this.timeout(5000);
		this.slow(4000);

		const opts = {
			force: true,
			ignorePlatformPaths: true,
			jdkPaths: [
				path.join(__dirname, 'mocks', 'jdk-1.8')
			]
		};

		Promise
			.all([
				jdklib.detect(opts),
				jdklib.detect(opts)
			])
			.then(results => {
				expect(results).to.be.an.Array;
				expect(results).to.have.lengthOf(2);
				expect(results[0]).to.deep.equal(results[1]);
				done();
			})
			.catch(done);
	});

	it('should return unique gawk objects for different paths', done => {
		const opts1 = {
			force: true,
			gawk: true,
			ignorePlatformPaths: true,
			jdkPaths: [
				path.join(__dirname, 'mocks', 'jdk-1.8')
			]
		};

		const opts2 = {
			force: true,
			gawk: true,
			ignorePlatformPaths: true,
			jdkPaths: [
				path.join(__dirname, 'mocks', 'jdk-1.7')
			]
		};

		Promise
			.all([
				jdklib.detect(opts1),
				jdklib.detect(opts1),
				jdklib.detect(opts2)
			])
			.then(results => {
				expect(results[0]).to.equal(results[1]);
				expect(results[0]).to.not.equal(results[2]);
				done();
			})
			.catch(done);
	});

	it('should return a gawk objects and receive updates', done => {
		const tmp = temp.mkdirSync('jdklib-');

		const opts = {
			force: true,
			gawk: true,
			ignorePlatformPaths: true,
			jdkPaths: tmp
		};

		fs.copySync(path.join(__dirname, 'mocks', 'jdk-1.8'), path.join(tmp, 'jdk-1.8'));

		let counter = 0;

		function checkDone(err) {
			if (err || ++counter === 2) {
				done(err);
			}
		}

		jdklib
			.detect(opts)
			.then(results => {
				validateJDKs(results.toJS(), ['1.8.0_92']);

				const unwatch = results.watch(_.debounce(evt => {
					try {
						unwatch();
						const src = evt.source;
						validateJDKs(src.toJS(), ['1.7.0_80']);
						checkDone();
					} catch (err) {
						checkDone(err);
					}
				}));
			})
			.then(() => {
				del.sync([ path.join(tmp, 'jdk-1.8') ], { force: true });
				fs.copySync(path.join(__dirname, 'mocks', 'jdk-1.7'), path.join(tmp, 'jdk-1.7'));
				return jdklib.detect(opts);
			})
			.then(results => {
				validateJDKs(results.toJS(), ['1.7.0_80']);
				checkDone();
			})
			.catch(checkDone);
	});

	it('should handle error when jdk paths is not an array of strings', done => {
		jdklib
			.detect({ ignorePlatformPaths: true, jdkPaths: [123] })
			.then(results => {
				done(new Error('Expected error when jdkPaths is not an array or string'));
			})
			.catch(err => {
				try {
					expect(err).to.be.an.TypeError;
					expect(err.message).to.equal('Expected jdkPaths to be an array of strings');
					done();
				} catch (e) {
					done(e);
				}
			});
	});

	it('should strip empty jdk paths', done => {
		jdklib
			.detect({ ignorePlatformPaths: true, jdkPaths: [''] })
			.then(results => {
				expect(results).to.have.lengthOf(0);
				done();
			})
			.catch(done);
	});
});

describe('watch()', () => {
	beforeEach(function () {
		this.JAVA_HOME = process.env.JAVA_HOME;
		this.PATH = process.env.PATH;
		process.env.JAVA_HOME = '';
		process.env.PATH = tempPATH;
		this.watcher = null;
	});

	afterEach(function () {
		process.env.JAVA_HOME = this.JAVA_HOME;
		process.env.PATH = this.PATH;
		if (this.watcher) {
			this.watcher.stop();
		}
		jdklib.resetCache();
	});

	it('should watch using defaults', function (done) {
		this.timeout(10000);
		this.slow(5000);

		this.watcher = jdklib
			.watch()
			.on('results', results => {
				validateJDKs(results);
				this.watcher.stop();
				done();
			})
			.on('error', done);
	});

	it('should watch directory for JDK to be added', function (done) {
		this.timeout(10000);
		this.slow(5000);

		const tmp = temp.mkdirSync('jdklib-');
		const opts = {
			force: true,
			ignorePlatformPaths: true,
			jdkPaths: [
				path.join(__dirname, 'mocks', 'jdk-1.8'),
				tmp
			]
		};

		let count = 0;

		this.watcher = jdklib
			.watch(opts)
			.on('results', results => {
				count++;
				if (count === 1) {
					validateJDKs(results, ['1.8.0_92']);
					fs.copySync(path.join(__dirname, 'mocks', 'jdk-1.7'), tmp);
				} else if (count === 2) {
					validateJDKs(results, ['1.7.0_80', '1.8.0_92']);
					del.sync([tmp], { force: true });
				} else if (count === 3) {
					this.watcher.stop();
					validateJDKs(results, ['1.8.0_92']);
					done();
				}
			})
			.on('error', done);
	});

	it('should watch directory for JDK to be deleted', function (done) {
		this.timeout(10000);
		this.slow(5000);

		const tmp = temp.mkdirSync('jdklib-');
		const opts = {
			force: true,
			ignorePlatformPaths: true,
			jdkPaths: [
				path.join(__dirname, 'mocks', 'jdk-1.8'),
				tmp
			]
		};

		fs.copySync(path.join(__dirname, 'mocks', 'jdk-1.7'), tmp);

		let count = 0;

		this.watcher = jdklib
			.watch(opts)
			.on('results', results => {
				count++;
				if (count === 1) {
					validateJDKs(results, ['1.7.0_80', '1.8.0_92']);
					del.sync([tmp], { force: true });
				} else if (count === 2) {
					validateJDKs(results, ['1.8.0_92']);
					this.watcher.stop();
					done();
				}
			})
			.on('error', done);
	});

	it('should return a gawk objects and receive updates', function (done) {
		this.timeout(10000);
		this.slow(5000);

		const tmp = temp.mkdirSync('jdklib-');
		const opts = {
			gawk: true,
			ignorePlatformPaths: true,
			jdkPaths: tmp
		};

		fs.copySync(path.join(__dirname, 'mocks', 'jdk-1.8'), path.join(tmp, 'jdk-1.8'));

		let counter = 0;
		let gobj = null;

		const checkDone = err => {
			if (err || ++counter === 1) {
				this.watcher.stop();
				done(err);
			}
		};

		this.watcher = jdklib
			.watch(opts)
			.on('results', results => {
				expect(results).to.be.instanceof(GawkArray);
				if (gobj === null) {
					validateJDKs(results.toJS(), ['1.8.0_92']);
					gobj = results;
					const unwatch = results.watch(_.debounce(evt => {
						try {
							unwatch();
							const src = evt.source;
							validateJDKs(src.toJS(), ['1.7.0_80']);
							checkDone();
						} catch (err) {
							checkDone(err);
						}
					}));
					del.sync([ path.join(tmp, 'jdk-1.8') ], { force: true });
					fs.copySync(path.join(__dirname, 'mocks', 'jdk-1.7'), path.join(tmp, 'jdk-1.7'));
				}
			})
			.on('error', checkDone);
	});

	it('should handle error when jdk paths is invalid', function (done) {
		this.watcher = jdklib
			.watch({ ignorePlatformPaths: true, jdkPaths: [123] })
			.on('results', results => {
				this.watcher.stop();
				done(new Error('Expected error when jdkPaths is not an array or string'));
			})
			.on('error', err => {
				try {
					this.watcher.stop();
					expect(err).to.be.an.TypeError;
					expect(err.message).to.equal('Expected jdkPaths to be an array of strings');
					done();
				} catch (e) {
					done(e);
				}
			});
	});
});
