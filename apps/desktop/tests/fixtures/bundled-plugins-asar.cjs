/** Exercise the built provisioner with Electron ASAR support enabled. */
const { app } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const originalFs = require('original-fs')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

const [modulePath, root] = process.argv.slice(2)
app.setPath('userData', join(root, 'browser'))
app.whenReady().then(async () => {
  try {
    assert.equal(process.type, 'browser')
    const noAsar = process.noAsar
    const { verifyBundledPlugins, seedBundledPlugins } = await import(pathToFileURL(modulePath).href)
    const resources = join(root, 'resources')
    const home = join(root, 'home')
    const profile = join(home, 'profiles/desktop')
    const archive = join(resources, 'dsh-pet/electron/resources/default_app.asar')
    assert.equal(fs.readFileSync(join(archive, 'marker.txt'), 'utf8'), 'archive contents')
    fs.mkdirSync(profile, { recursive: true })
    fs.writeFileSync(join(profile, 'package.json'), JSON.stringify({
      name: 'desktop', private: true, dependencies: {}, dsh: { profile: { bundles: [] } },
    }))
    verifyBundledPlugins(resources)
    seedBundledPlugins(profile, resources, home)
    assert.deepEqual(originalFs.readFileSync(join(home, 'electron/resources/default_app.asar')), originalFs.readFileSync(archive))
    assert.equal(fs.readFileSync(join(home, 'electron/resources/default_app.asar/marker.txt'), 'utf8'), 'archive contents')
    assert.equal(JSON.parse(fs.readFileSync(join(profile, 'node_modules/dsh-pet/package.json'))).name, 'dsh-pet')
    seedBundledPlugins(profile, resources, home)
    assert.equal(process.noAsar, noAsar)
    assert.equal(fs.readFileSync(join(archive, 'marker.txt'), 'utf8'), 'archive contents')
    originalFs.appendFileSync(archive, 'corruption')
    assert.throws(() => verifyBundledPlugins(resources), /Electron file mismatch/)
    console.log('BUNDLED_PLUGINS_ASAR_OK')
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
