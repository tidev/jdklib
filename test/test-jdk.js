import * as jdklib from '../src/index';
import { expect } from 'chai';
import fs from 'fs';
import path from 'path';

const isWindows = process.platform === 'win32';

describe('detect', () => {
	it('should detect installed JDKs', function (done) {
		this.timeout(5000);
		this.slow(4000);

		jdklib.detect()
			.then(results => {
				expect(results).to.be.an.Object;
				expect(results).to.have.keys('jdks', 'home');

				expect(results.jdks).to.be.an.Object;
				Object.keys(results.jdks).forEach(id => {
					const jdk = results.jdks[id];
					expect(jdk).to.be.an.Object;
					expect(jdk).to.have.keys('path', 'version', 'build', 'architecture', 'executables');
					expect(jdk.path).to.be.a.String;
					expect(jdk.path).to.not.equal('');
					expect(() => fs.statSync(jdk.path)).to.not.throw(Error);
					expect(jdk.version).to.be.a.String;
					expect(jdk.version).to.not.equal('');
					expect(jdk.build).to.be.a.String;
					expect(jdk.build).to.not.equal('');
					expect(id).to.equal(jdk.version + '_' + jdk.build);
					expect(jdk.architecture).to.be.a.String;
					expect(jdk.architecture).to.be.oneOf(['32bit', '64bit']);
					expect(jdk.executables).to.be.an.Object;
					Object.keys(jdk.executables).forEach(name => {
						expect(jdk.executables[name]).to.be.a.String;
						expect(jdk.executables[name]).to.not.equal('');
						expect(() => fs.statSync(jdk.executables[name])).to.not.throw(Error);
					});
				});

				if (results.home !== null) {
					expect(results.home).to.be.a.String;
					expect(results.home).to.not.equal('');
				}

				done();
			})
			.catch(err => done(err));
	});

	it('should cache previous results', function (done) {
		this.timeout(5000);
		this.slow(4000);

		const fakeJDKPath = path.join(__dirname, 'fakejdk');

		// because this is the second test, the results are already cached from
		// the previous test and thus `home` will not equal the fake JDK path
		jdklib.detect({ javaHome: fakeJDKPath })
			.then(results => {
				expect(results).to.be.an.Object;
				expect(results).to.have.keys('jdks', 'home');
				expect(results.home).to.equal(null);
				done();
			})
			.catch(err => done(err));
	});

	// our fake JDK only works on Linux and OS X :(
	(isWindows ? it.skip : it)('should find a JDK in the java home', function (done) {
		this.timeout(5000);
		this.slow(4000);

		const fakeJDKPath = path.join(__dirname, 'fakejdk');

		jdklib.detect({ bypassCache: true, javaHome: fakeJDKPath })
			.then(results => {
				expect(results).to.be.an.Object;
				expect(results).to.have.keys('jdks', 'home');
				expect(results.home).to.equal(fakeJDKPath);
				done();
			})
			.catch(err => done(err));
	});
});
