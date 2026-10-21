#!/usr/bin/env python3
"""把站点素材上传到 7bu 图床，并把访问地址写进 tools/cdn-urls.txt。

用法: python3 tools/upload.py [token]
token 也可以放在环境变量 SEVENBU_TOKEN 里。不传则用脚本内的默认值。

只上传网页真正会加载的那几张（贴纸 + 主背景 + 四张卡片），
preview/ 里的效果图是文档，不上传。
"""
import json
import os
import subprocess
import sys

TOKEN = sys.argv[1] if len(sys.argv) > 1 else os.environ.get(
    'SEVENBU_TOKEN', '2720|fB6f2v5NGUuij01liP558PPDQIloPsfvQaQGkIbS')
API = 'https://7bu.top/api/v1/upload'
STRATEGY = 10                      # 该账号下唯一的策略：「本地存储」

FILES = ['daishu.webp', 'daishu.png', 'photo.jpg', 'p1.jpg', 'p2.jpg', 'p3.jpg', 'p4.jpg']

rows = []
for f in FILES:
    if not os.path.exists(f):
        print('!! 文件不存在，跳过', f)
        continue
    r = subprocess.run(
        ['curl', '-s', '-m', '90', '-X', 'POST',
         '-H', 'Authorization: Bearer ' + TOKEN,
         '-H', 'Accept: application/json',
         '-F', 'file=@' + f, '-F', 'strategy_id=%d' % STRATEGY, API],
        capture_output=True, text=True)
    try:
        d = json.loads(r.stdout)
    except Exception:
        print('!! 响应无法解析', f, r.stdout[:200])
        continue
    if not d.get('status'):
        print('!! 上传失败', f, d.get('message'))
        continue
    dd = d['data']
    rows.append((f, dd['links']['url'], float(dd['size']), dd['key']))
    print('OK  %-14s %8.1f KB  %s' % (f, float(dd['size']), dd['links']['url']))

with open('tools/cdn-urls.txt', 'w', encoding='utf-8') as fh:
    fh.write('# 7bu 图床托管地址，由 tools/upload.py 生成\n')
    fh.write('# 用法：把 index.html 里对应的本地文件名换成这里的 URL 即可\n')
    for f, u, s, k in rows:
        fh.write('%-14s %s\n' % (f, u))
print('\n%d 张已上传，映射写入 tools/cdn-urls.txt' % len(rows))
