const fs = require('node:fs')
const path = require('node:path')

const projectDir = path.resolve(__dirname, '..')
const repoDir = path.resolve(projectDir, '..')
const buildDir = path.join(projectDir, 'build')
const publicDir = path.join(projectDir, 'renderer', 'public')
const ocrDir = path.join(projectDir, 'resources', 'ocr')

fs.mkdirSync(buildDir, { recursive: true })
fs.mkdirSync(publicDir, { recursive: true })
fs.mkdirSync(ocrDir, { recursive: true })
fs.copyFileSync(
  path.join(repoDir, 'Resources', 'Brand', 'Ta-AppIcon.png'),
  path.join(buildDir, 'icon.png'),
)
fs.copyFileSync(
  path.join(repoDir, 'Resources', 'Brand', 'Ta-AppIcon.png'),
  path.join(publicDir, 'icon.png'),
)

function findTrainedData(packageName, language) {
  const packageRoot = path.dirname(require.resolve(`${packageName}/package.json`))
  const candidates = []
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(entryPath)
      if (entry.isFile() && entry.name === `${language}.traineddata.gz`) candidates.push(entryPath)
    }
  }
  visit(packageRoot)
  if (!candidates.length) throw new Error(`Cannot find ${language}.traineddata.gz in ${packageName}`)
  return candidates[0]
}

for (const [packageName, language] of [
  ['@tesseract.js-data/eng', 'eng'],
  ['@tesseract.js-data/chi_sim', 'chi_sim'],
]) {
  fs.copyFileSync(findTrainedData(packageName, language), path.join(ocrDir, `${language}.traineddata.gz`))
}

console.log(`Prepared icon and offline OCR data in ${projectDir}`)
