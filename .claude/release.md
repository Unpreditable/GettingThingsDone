---
tag_source: manifest.json#version
version_bump_cmd: "jq --arg v \"{new_version}\" '.version = $v' manifest.json > manifest.tmp && mv manifest.tmp manifest.json"
build: npm run build
test: npm test
artifacts:
  - main.js
  - styles.css
  - manifest.json
changelog: true
---

## Version bump

Read the current version from `manifest.json#version`. Ask the user whether this is a Major, Minor, or Patch bump, then compute the new version:
- Major: `X.0.0`
- Minor: `A.Y.0`
- Patch: `A.B.Z`

Run the `version_bump_cmd` from frontmatter, substituting `{new_version}` with the computed version string.
