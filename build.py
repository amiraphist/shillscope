# build: index.src.html + bg.jpg -> index.html ; worker.head.js + HTML + worker.tail.js -> worker.js
import base64, json
src = open('index.src.html').read()
b = base64.b64encode(open('bgv.jpg','rb').read()).decode()
html = src.replace('__BG__', '"data:image/jpeg;base64,' + b + '"')
open('index.html','w').write(html)
open('worker.js','w').write(open('worker.head.js').read() + json.dumps(html) + open('worker.tail.js').read())
print('built', len(html), 'bytes')
