import appc from 'node-appc';
import del from 'del';
import { expect } from 'chai';
import fs from 'fs-extra';
import * as jdklib from '../src/index';
import path from 'path';
import temp from 'temp';

// in our tests, we need to wipe the PATH environment variable so that JDKs
// other than our mocks are found, but on Windows, we need to leave
// C:\Windows\System32 in the path so that we can query the Windows registry
const tempPATH = process.platform !== 'win32' ? '' : (function () {
	const windowsDir = appc.path.expand('%SystemRoot%');
	return process.env.PATH
		.split(path.delimiter)
		.filter(p => p.indexOf(windowsDir) === 0)
		.join(path.delimiter);
}());

temp.track();

describe('JDK', () => {
	it('should throw error if dir is not a string', () => {
		expect(() => {
			new jdklib.JDK();
		}).to.throw(TypeError, 'Expected directory to be a valid string');

		expect(() => {
			new jdklib.JDK(123);
		}).to.throw(TypeError, 'Expected directory to be a valid string');
	});

	it('should throw error if dir does not exist', () => {
		expect(() => {
			new jdklib.JDK('doesnotexist');
		}).to.throw(Error, 'Directory does not exist');
	});
});

describe('detect()', () => {
	beforeEach(function () {
		this.JAVA_HOME        = process.env.JAVA_HOME;
		this.PATH             = process.env.PATH;
		process.env.PATH      = tempPATH;
		process.env.NODE_APPC_SKIP_GLOBAL_SEARCH_PATHS = 1;
		process.env.NODE_APPC_SKIP_GLOBAL_ENVIRONMENT_PATHS = 1;
		process.env.NODE_APPC_SKIP_GLOBAL_EXECUTABLE_PATH = 1;
		delete process.env.JAVA_HOME;
	});

	afterEach(function () {
		process.env.JAVA_HOME = this.JAVA_HOME;
		process.env.PATH      = this.PATH;
		delete process.env.NODE_APPC_SKIP_GLOBAL_SEARCH_PATHS;
		delete process.env.NODE_APPC_SKIP_GLOBAL_ENVIRONMENT_PATHS;
		delete process.env.NODE_APPC_SKIP_GLOBAL_EXECUTABLE_PATH;
		jdklib.resetCache();
	});

	it('should detect JDK using defaults', function (done) {
		this.timeout(10000);
		this.slow(5000);

		this.JAVA_HOME && (process.env.JAVA_HOME = this.JAVA_HOME);
		this.PATH      && (process.env.PATH      = this.PATH);
		delete process.env.NODE_APPC_SKIP_GLOBAL_SEARCH_PATHS;
		delete process.env.NODE_APPC_SKIP_GLOBAL_ENVIRONMENT_PATHS;
		delete process.env.NODE_APPC_SKIP_GLOBAL_EXECUTABLE_PATH;

		jdklib
			.detect()
			.then(results => {
				validateResults(results);

				// one more time
				return jdklib
					.detect()
					.then(results => {
						validateResults(results);
						done();
					});
			})
			.catch(done);
	});

	it('should detect JDK using single mock JDK', done => {
		jdklib
			.detect({
				force: true,
				paths: [
					path.join(__dirname, 'mocks', 'jdk-1.8'),
					__dirname,
					'/Users/griswald/doesnotexist'
				]
			})
			.then(results => {
				validateResults(results, ['1.8.0_92']);
				done();
			})
			.catch(done);
	});

	it('should detect JDK using multiple mock JDKs', done => {
		jdklib
			.detect({
				force: true,
				paths: path.join(__dirname, 'mocks')
			})
			.then(results => {
				validateResults(results, ['1.6.0_45', '1.7.0_80', '1.8.0_92', '1.8.0_92']);
				done();
			})
			.catch(done);
	});

	it('should not find any jdks in an empty directory', done => {
		jdklib
			.detect({
				force: true,
				paths: path.join(__dirname, 'mocks', 'empty')
			})
			.then(results => {
				expect(results).to.be.an.Array;
				expect(results).to.have.lengthOf(0);
				done();
			})
			.catch(done);
	});

	it('should not find any jdks in an incomplete jdk directory', done => {
		jdklib
			.detect({
				force: true,
				paths: path.join(__dirname, 'mocks', 'incomplete-jdk')
			})
			.then(results => {
				expect(results).to.be.an.Array;
				expect(results).to.have.lengthOf(0);
				done();
			})
			.catch(done);
	});

	it('should not find any jdks in a jdk directory with bad binaries', done => {
		jdklib
			.detect({
				force: true,
				paths: path.join(__dirname, 'mocks', 'bad-bin-jdk')
			})
			.then(results => {
				expect(results).to.be.an.Array;
				expect(results).to.have.lengthOf(0);
				done();
			})
			.catch(done);
	});

	it('should find a 32-bit jdk', done => {
		jdklib
			.detect({
				force: true,
				paths: path.join(__dirname, 'mocks', 'jdk-1.8-32bit')
			})
			.then(results => {
				validateResults(results, ['1.8.0_92']);
				done();
			})
			.catch(done);
	});

	it('should find mock jdk via JAVA_HOME environment variable', done => {
		process.env.JAVA_HOME = path.join(__dirname, 'mocks', 'jdk-1.8');
		jdklib
			.detect({ force: true })
			.then(results => {
				validateResults(results, ['1.8.0_92']);
				done();
			})
			.catch(done);
	});

	it('should not find a JDK when JAVA_HOME points to a file', done => {
		process.env.JAVA_HOME = __filename;
		jdklib
			.detect({ force: true })
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
			.detect({ force: true })
			.then(results => {
				validateResults(results, ['1.8.0_92']);
				done();
			})
			.catch(done);
	});

	it('should not find a JDK when paths is a file', done => {
		jdklib
			.detect({
				force: true,
				paths: __filename
			})
			.then(results => {
				expect(results).to.be.an.Array;
				expect(results).to.have.lengthOf(0);
				done();
			})
			.catch(done);
	});

	it('should not re-detect after initial detect', done => {
		const tmp = temp.mkdirSync('jdklib-test-');
		const opts = {
			force: true,
			paths: [
				path.join(__dirname, 'mocks', 'jdk-1.8'),
				tmp
			]
		};

		// run the initial detect
		jdklib
			.detect(opts)
			.then(results => {
				validateResults(results, ['1.8.0_92']);
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
				validateResults(results, ['1.8.0_92']);
			})
			.then(() => {
				// force re-detect again to find the JDK 1.7 we copied
				opts.force = true;
				return jdklib.detect(opts);
			})
			.then(results => {
				validateResults(results, ['1.7.0_80', '1.8.0_92']);
				done();
			})
			.catch(done);
	});

	it('should queue up detect calls', function (done) {
		this.timeout(5000);
		this.slow(4000);

		const opts = {
			force: true,
			paths: path.join(__dirname, 'mocks', 'jdk-1.8')
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
			paths: path.join(__dirname, 'mocks', 'jdk-1.8')
		};

		const opts2 = {
			force: true,
			gawk: true,
			paths: path.join(__dirname, 'mocks', 'jdk-1.7')
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
		const tmp = temp.mkdirSync('jdklib-test-');

		const opts = {
			force: true,
			gawk: true,
			paths: tmp
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
				validateResults(results.toJS(), ['1.8.0_92']);

				const unwatch = results.watch(appc.util.debounce(evt => {
					try {
						unwatch();
						validateResults(evt.source.toJS(), ['1.7.0_80']);
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
				validateResults(results.toJS(), ['1.7.0_80']);
				checkDone();
			})
			.catch(checkDone);
	});

	it('should handle error when jdk paths is not an array of strings', done => {
		jdklib
			.detect({ paths: [ 123 ] })
			.then(results => {
				done(new Error('Expected rejection'));
			})
			.catch(err => {
				try {
					expect(err).to.be.an.TypeError;
					expect(err.message).to.equal('Expected paths to be a string or an array of strings');
					done();
				} catch (e) {
					done(e);
				}
			});
	});

	it('should strip empty jdk paths', done => {
		jdklib
			.detect({ paths: [ '' ] })
			.then(results => {
				expect(results).to.have.lengthOf(0);
				done();
			})
			.catch(done);
	});
});

describe('watch()', () => {
	beforeEach(function () {
		this.JAVA_HOME        = process.env.JAVA_HOME;
		this.PATH             = process.env.PATH;
		process.env.JAVA_HOME = '';
		process.env.PATH      = tempPATH;
		process.env.NODE_APPC_SKIP_GLOBAL_SEARCH_PATHS = 1;
		process.env.NODE_APPC_SKIP_GLOBAL_ENVIRONMENT_PATHS = 1;
		process.env.NODE_APPC_SKIP_GLOBAL_EXECUTABLE_PATH = 1;
		this.watcher          = null;
	});

	afterEach(function () {
		process.env.JAVA_HOME = this.JAVA_HOME;
		process.env.PATH      = this.PATH;
		delete process.env.NODE_APPC_SKIP_GLOBAL_SEARCH_PATHS;
		delete process.env.NODE_APPC_SKIP_GLOBAL_ENVIRONMENT_PATHS;
		delete process.env.NODE_APPC_SKIP_GLOBAL_EXECUTABLE_PATH;
		this.watcher && this.watcher.stop();
		jdklib.resetCache();
	});

	it('should watch using defaults', function (done) {
		this.timeout(10000);
		this.slow(5000);

		this.JAVA_HOME && (process.env.JAVA_HOME = this.JAVA_HOME);
		this.PATH      && (process.env.PATH      = this.PATH);
		delete process.env.NODE_APPC_SKIP_GLOBAL_SEARCH_PATHS;
		delete process.env.NODE_APPC_SKIP_GLOBAL_ENVIRONMENT_PATHS;
		delete process.env.NODE_APPC_SKIP_GLOBAL_EXECUTABLE_PATH;

		this.watcher = jdklib
			.watch()
			.on('results', results => {
				try {
					this.watcher.stop();
					validateResults(results);
					done();
				} catch (e) {
					done(e);
				}
			})
			.on('error', done);
	});

	it('should watch directory for JDK to be added', function (done) {
		this.timeout(10000);
		this.slow(5000);

		const tmp = temp.mkdirSync('jdklib-test-');
		const opts = {
			force: true,
			paths: [
				path.join(__dirname, 'mocks', 'jdk-1.8'),
				tmp
			]
		};

		let count = 0;

		this.watcher = jdklib
			.watch(opts)
			.on('results', results => {
				try {
					count++;
					if (count === 1) {
						validateResults(results, ['1.8.0_92']);
						fs.copySync(path.join(__dirname, 'mocks', 'jdk-1.7'), tmp);
					} else if (count === 2) {
						validateResults(results, ['1.7.0_80', '1.8.0_92']);
						del.sync([tmp], { force: true });
					} else if (count === 3) {
						this.watcher.stop();
						validateResults(results, ['1.8.0_92']);
						done();
					}
				} catch (e) {
					this.watcher.stop();
					done(e);
				}
			})
			.on('error', done);
	});

	it('should watch directory for JDK to be deleted', function (done) {
		this.timeout(10000);
		this.slow(5000);

		const tmp = temp.mkdirSync('jdklib-test-');
		const opts = {
			force: true,
			paths: [
				path.join(__dirname, 'mocks', 'jdk-1.8'),
				tmp
			]
		};

		fs.copySync(path.join(__dirname, 'mocks', 'jdk-1.7'), tmp);

		let count = 0;

		this.watcher = jdklib
			.watch(opts)
			.on('results', results => {
				try {
					count++;
					if (count === 1) {
						validateResults(results, ['1.7.0_80', '1.8.0_92']);
						del.sync([tmp], { force: true });
					} else if (count === 2) {
						this.watcher.stop();
						validateResults(results, ['1.8.0_92']);
						done();
					}
				} catch (e) {
					done(e);
				}
			})
			.on('error', done);
	});

	it('should return a gawk objects and receive updates', function (done) {
		this.timeout(10000);
		this.slow(5000);

		const tmp = temp.mkdirSync('jdklib-test-');
		const opts = {
			gawk: true,
			paths: tmp
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
				try {
					expect(results).to.be.instanceof(appc.gawk.GawkArray);
					if (gobj === null) {
						validateResults(results.toJS(), ['1.8.0_92']);
						gobj = results;
						const unwatch = results.watch(appc.util.debounce(evt => {
							try {
								unwatch();
								validateResults(evt.source.toJS(), ['1.7.0_80']);
								checkDone();
							} catch (err) {
								checkDone(err);
							}
						}));
						del.sync([ path.join(tmp, 'jdk-1.8') ], { force: true });
						fs.copySync(path.join(__dirname, 'mocks', 'jdk-1.7'), path.join(tmp, 'jdk-1.7'));
					}
				} catch (e) {
					checkDone(e);
				}
			})
			.on('error', checkDone);
	});

	it('should handle error when jdk paths is invalid', function (done) {
		this.watcher = jdklib
			.watch({ paths: [ 123 ] })
			.on('results', results => {
				this.watcher.stop();
				done(new Error('Expected error to be emitted'));
			})
			.on('error', err => {
				try {
					this.watcher.stop();
					expect(err).to.be.an.TypeError;
					expect(err.message).to.equal('Expected paths to be a string or an array of strings');
					done();
				} catch (e) {
					done(e);
				}
			});
	});
});

function validateResults(results, versions) {
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
