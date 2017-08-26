# JDK Utility Library

[![NPM Version][npm-image]][npm-url]
[![NPM Downloads][downloads-image]][downloads-url]
[![Travis CI Build][travis-image]][travis-url]
[![Deps][david-image]][david-url]
[![Dev Deps][david-dev-image]][david-dev-url]

> Note: jdklib requires Node.js 4 or newer.

## Installation

    npm install jdklib

## Examples

Detect installed JDKs:

```javascript
import * as jdklib from 'jdklib';

jdklib
    .detect()
    .then(jdkInfo => {
        console.info(jdkInfo);
    })
    .catch(err => console.error);
```

## Reporting Bugs or Submitting Fixes

If you run into problems, and trust us, there are likely plenty of them at this
point -- please create an [Issue](https://github.com/appcelerator/jdklib/issues)
or, even better, send us a pull request.

## Contributing

jdklib is an open source project. jdklib wouldn't be where it is now without
contributions by the community. Please consider forking jdklib to improve,
enhance or fix issues. If you feel like the community will benefit from your
fork, please open a pull request.

To protect the interests of the jdklib contributors, Appcelerator, customers
and end users we require contributors to sign a Contributors License Agreement
(CLA) before we pull the changes into the main repository. Our CLA is simple and
straightforward - it requires that the contributions you make to any
Appcelerator open source project are properly licensed and that you have the
legal authority to make those changes. This helps us significantly reduce future
legal risk for everyone involved. It is easy, helps everyone, takes only a few
minutes, and only needs to be completed once.

[You can digitally sign the CLA](http://bit.ly/app_cla) online. Please indicate
your email address in your first pull request so that we can make sure that will
locate your CLA.  Once you've submitted it, you no longer need to send one for
subsequent submissions.

## License

This project is open source and provided under the Apache Public License (version 2). Please make sure you see the LICENSE file included in this distribution for more details on the license. Also, please take notice of the privacy notice at the end of the file.

(C) Copyright 2016-2017, [Axway, Inc](http://www.appcelerator.com) All Rights Reserved.

[npm-image]: https://img.shields.io/npm/v/jdklib.svg
[npm-url]: https://npmjs.org/package/jdklib
[downloads-image]: https://img.shields.io/npm/dm/jdklib.svg
[downloads-url]: https://npmjs.org/package/jdklib
[travis-image]: https://img.shields.io/travis/appcelerator/jdklib.svg
[travis-url]: https://travis-ci.org/appcelerator/jdklib
[david-image]: https://img.shields.io/david/appcelerator/jdklib.svg
[david-url]: https://david-dm.org/appcelerator/jdklib
[david-dev-image]: https://img.shields.io/david/dev/appcelerator/jdklib.svg
[david-dev-url]: https://david-dm.org/appcelerator/jdklib#info=devDependencies
