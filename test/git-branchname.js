
const os = require('os');
var Git = require('sn-project/lib/git');

const git = new Git({dir: `${os.tmpdir()}/git-branchname-test`});

git.init().then(() => {
    return git.createBranch('¢bl/a', '|¢', '¢984123490idsjf9238h  " r b°¬|¢¦@#°9b89¢');
}).then(console.log);