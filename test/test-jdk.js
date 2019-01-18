import JDK, { detect } from '../dist/index';

import path from 'path';
import { exe } from 'appcd-subprocess';

describe('JDK', () => {
	it('should throw error if dir is not a string', () => {
		expect(() => {
			new JDK();
		}).to.throw(TypeError, 'Expected directory to be a valid string');

		expect(() => {
			new JDK(123);
		}).to.throw(TypeError, 'Expected directory to be a valid string');
	});

	it('should throw error if dir does not exist', () => {
		return detect('doesnotexist')
			.then(() => {
				throw new Error('Expected error');
			}, err => {
				expect(err).to.be.instanceof(Error);
				expect(err.message).to.equal('Directory does not exist');
			});
	});

	it('should error if dir is missing the JVM library', () => {
		return detect(path.join(__dirname, 'mocks', 'empty'))
			.then(() => {
				throw new Error('Expected error');
			}, err => {
				expect(err).to.be.instanceof(Error);
				expect(err.message).to.equal('Directory missing JVM library');
			});
	});

	it('should error if dir is missing essential jdk tools', () => {
		return detect(path.join(__dirname, 'mocks', 'incomplete-jdk'))
			.then(() => {
				throw new Error('Expected error');
			}, err => {
				expect(err).to.be.instanceof(Error);
				expect(err.message).to.equal('Directory missing required program');
			});
	});

	it('should detect JDK 1.6', () => {
		const dir = path.join(__dirname, 'mocks', 'jdk-1.6');
		return detect(dir)
			.then(jdk => {
				expect(jdk.arch).to.equal('64bit');
				expect(jdk.build).to.equal(45);
				expect(jdk.executables).to.deep.equal({
					java:      path.join(dir, 'bin', 'java' + exe),
					javac:     path.join(dir, 'bin', 'javac' + exe),
					keytool:   path.join(dir, 'bin', 'keytool' + exe),
					jarsigner: path.join(dir, 'bin', 'jarsigner' + exe)
				});
				expect(jdk.path).to.equal(dir);
				expect(jdk.version).to.equal('1.6.0');
			});
	});

	it('should detect JDK 1.7', () => {
		const dir = path.join(__dirname, 'mocks', 'jdk-1.7');
		return detect(dir)
			.then(jdk => {
				expect(jdk.arch).to.equal('64bit');
				expect(jdk.build).to.equal(80);
				expect(jdk.executables).to.deep.equal({
					java:      path.join(dir, 'bin', 'java' + exe),
					javac:     path.join(dir, 'bin', 'javac' + exe),
					keytool:   path.join(dir, 'bin', 'keytool' + exe),
					jarsigner: path.join(dir, 'bin', 'jarsigner' + exe)
				});
				expect(jdk.path).to.equal(dir);
				expect(jdk.version).to.equal('1.7.0');
			});
	});

	it('should detect JDK 1.8 64-bit', () => {
		const dir = path.join(__dirname, 'mocks', 'jdk-1.8');
		return detect(dir)
			.then(jdk => {
				expect(jdk.arch).to.equal('64bit');
				expect(jdk.build).to.equal(92);
				expect(jdk.executables).to.deep.equal({
					java:      path.join(dir, 'bin', 'java' + exe),
					javac:     path.join(dir, 'bin', 'javac' + exe),
					keytool:   path.join(dir, 'bin', 'keytool' + exe),
					jarsigner: path.join(dir, 'bin', 'jarsigner' + exe)
				});
				expect(jdk.path).to.equal(dir);
				expect(jdk.version).to.equal('1.8.0');
			});
	});

	it('should detect JDK 1.8 32-bit', () => {
		const dir = path.join(__dirname, 'mocks', 'jdk-1.8-32bit');
		return detect(dir)
			.then(jdk => {
				expect(jdk.arch).to.equal('32bit');
				expect(jdk.build).to.equal(92);
				expect(jdk.executables).to.deep.equal({
					java:      path.join(dir, 'bin', 'java' + exe),
					javac:     path.join(dir, 'bin', 'javac' + exe),
					keytool:   path.join(dir, 'bin', 'keytool' + exe),
					jarsigner: path.join(dir, 'bin', 'jarsigner' + exe)
				});
				expect(jdk.path).to.equal(dir);
				expect(jdk.version).to.equal('1.8.0');
			});
	});

	(process.platform === 'darwin' ? it : it.skip)('should detect JDK 1.8 64-bit with macOS pathing', () => {
		const dir = path.join(__dirname, 'mocks', 'jdk-1.8-darwin');
		return detect(dir)
			.then(jdk => {
				expect(jdk.arch).to.equal('64bit');
				expect(jdk.build).to.equal(92);
				expect(jdk.executables).to.deep.equal({
					java:      path.join(dir, 'Contents', 'Home', 'bin', 'java' + exe),
					javac:     path.join(dir, 'Contents', 'Home', 'bin', 'javac' + exe),
					keytool:   path.join(dir, 'Contents', 'Home', 'bin', 'keytool' + exe),
					jarsigner: path.join(dir, 'Contents', 'Home', 'bin', 'jarsigner' + exe)
				});
				expect(jdk.path).to.equal(path.join(dir, 'Contents', 'Home'));
				expect(jdk.version).to.equal('1.8.0');
			});
	});

	it('should detect JDK 9', () => {
		const dir = path.join(__dirname, 'mocks', 'jdk-9');
		return detect(dir)
			.then(jdk => {
				expect(jdk.arch).to.equal('64bit');
				expect(jdk.build).to.equal(181);
				expect(jdk.executables).to.deep.equal({
					java:      path.join(dir, 'bin', 'java' + exe),
					javac:     path.join(dir, 'bin', 'javac' + exe),
					keytool:   path.join(dir, 'bin', 'keytool' + exe),
					jarsigner: path.join(dir, 'bin', 'jarsigner' + exe)
				});
				expect(jdk.path).to.equal(dir);
				expect(jdk.version).to.equal('9');
			});
	});

	(process.platform === 'darwin' ? it : it.skip)('should detect JDK 9 with macOS pathing', () => {
		const dir = path.join(__dirname, 'mocks', 'jdk-9-darwin');
		return detect(dir)
			.then(jdk => {
				expect(jdk.arch).to.equal('64bit');
				expect(jdk.build).to.equal(11);
				expect(jdk.executables).to.deep.equal({
					java:      path.join(dir, 'Contents', 'Home', 'bin', 'java' + exe),
					javac:     path.join(dir, 'Contents', 'Home', 'bin', 'javac' + exe),
					keytool:   path.join(dir, 'Contents', 'Home', 'bin', 'keytool' + exe),
					jarsigner: path.join(dir, 'Contents', 'Home', 'bin', 'jarsigner' + exe)
				});
				expect(jdk.path).to.equal(path.join(dir, 'Contents', 'Home'));
				expect(jdk.version).to.equal('9.0.1');
			});
	});

	it('should not detect version or arch if javac is not found', () => {
		const dir = path.join(__dirname, 'mocks', 'bad-bin-jdk');
		const jdk = new JDK(dir);
		delete jdk.executables.javac;
		return jdk.init()
			.then(jdk => {
				expect(jdk.arch).to.be.null;
				expect(jdk.build).to.be.null;
				expect(jdk.executables).to.deep.equal({
					java:      path.join(dir, 'bin', 'java' + exe),
					keytool:   path.join(dir, 'bin', 'keytool' + exe),
					jarsigner: path.join(dir, 'bin', 'jarsigner' + exe)
				});
				expect(jdk.path).to.equal(dir);
				expect(jdk.version).to.be.null;
			});
	});

	it('should not detect version if javac is bad', async () => {
		const dir = path.join(__dirname, 'mocks', 'bad-bin-jdk');
		const jdk = await detect(dir);
		expect(jdk.arch).to.be.null;
		expect(jdk.build).to.be.null;
		expect(jdk.executables).to.deep.equal({
			java:      path.join(dir, 'bin', 'java' + exe),
			javac:     path.join(dir, 'bin', 'javac' + exe),
			keytool:   path.join(dir, 'bin', 'keytool' + exe),
			jarsigner: path.join(dir, 'bin', 'jarsigner' + exe)
		});
		expect(jdk.path).to.equal(dir);
		expect(jdk.version).to.be.null;
	});
});
