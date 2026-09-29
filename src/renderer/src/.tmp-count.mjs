import fs from 'fs'

const files = [
  'pages/SettingsPage.tsx',
  ...fs.readdirSync('pages/settings').map((f) => 'pages/settings/' + f),
  'pages/AgentPage.tsx'
]
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8')
  const c = (re) => (s.match(re) || []).length
  console.log(
    f.padEnd(38),
    'switchrow:', c(/className="switch-row"/g),
    'field:', c(/className="field"/g),
    'fieldlabel:', c(/className="field-label"/g),
    'range:', c(/type="range"/g),
    'sectitle:', c(/className="sec-title"/g),
    'hint12text4:', c(/fontSize: 12, color: 'var\(--text-4\)'/g),
    'cardpad:', c(/className="card card-pad"/g)
  )
}
