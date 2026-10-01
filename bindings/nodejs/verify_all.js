'use strict';

const fs = require('fs');
const path = require('path');
const { LicenseGuard, VerificationCode } = require('./licenseguard');

const base = path.resolve(__dirname, '..', 'testdata');
const publicKey = fs.readFileSync(path.join(base, 'public_key.bin'));

const checks = [
    ['l1.json', 'context_l1.json', VerificationCode.VALID],
    ['l2.json', 'context_l2.json', VerificationCode.VALID],
    ['l3.json', 'context_l3.json', VerificationCode.VALID],
    ['l1_tampered.json', 'context_l1.json', VerificationCode.INVALID_SIGNATURE],
];

const guard = new LicenseGuard();
let fails = 0;

console.log(`LicenseGuard Node.js self-test (fixtures: ${base})`);
for (const [certName, ctxName, expected] of checks) {
    const result = guard.verify(
        fs.readFileSync(path.join(base, certName)),
        publicKey,
        fs.readFileSync(path.join(base, ctxName))
    );
    const pass = result.status === 0 && result.code === expected;
    console.log(
        `  ${certName.padEnd(18)} status=${result.status} code=${result.code} ` +
        `(${VerificationCode.name(result.code)})  ${pass ? 'PASS' : 'FAIL'}`
    );
    if (!pass) fails++;
}

if (fails) {
    console.log(`FAIL (${fails})`);
    process.exit(1);
}
console.log('ALL PASS');