# build: index.src.html -> index.html ; worker.head.js + HTML + worker.tail.js -> worker.js  (bg = HUD canvas, no image)
import json
html = open('index.src.html').read().replace('__BG__', 'none')
open('index.html','w').write(html)
open('worker.js','w').write(open('worker.head.js').read() + json.dumps(html) + open('worker.tail.js').read())
print('built', len(html), 'bytes')
