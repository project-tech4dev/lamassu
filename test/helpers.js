// Loads the shared browser modules into globalThis.DV in dependency order.
require('../src/shared/strings.js');
require('../src/shared/levels.js');
require('../src/shared/domain.js');
require('../src/shared/classify.js');
require('../src/shared/settings.js');
require('../src/shared/drivepage.js');
require('../src/shared/status.js');
require('../src/background/drive-api.js');

module.exports = globalThis.DV;
