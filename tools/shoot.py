#!/usr/bin/env python3
"""用 CDP 在真实时间下抓页面关键帧。

为什么不用 --virtual-time-budget：虚拟时间只推进定时器，rAF 与 CSS transition 都不走，
抓出来的是假帧（实测只有 2 帧 / 17ms）。这里用真实时间 + CDP 截图。

用法: python3 tools/shoot.py <url> <宽> <高> <输出前缀> [时间点,时间点,...]
例:   python3 tools/shoot.py http://127.0.0.1:8899/ 1440 900 /tmp/shot 0,3,6,9,12,17
"""
import base64
import json
import subprocess
import sys
import time
import urllib.request

import websocket

url = sys.argv[1]
W = int(sys.argv[2])
H = int(sys.argv[3])
prefix = sys.argv[4]
times = [float(x) for x in (sys.argv[5].split(',') if len(sys.argv) > 5 else ['0', '3', '6', '9', '12', '17'])]

PORT = 9222


def up():
    try:
        urllib.request.urlopen('http://127.0.0.1:%d/json/version' % PORT, timeout=1)
        return True
    except Exception:
        return False


if not up():
    subprocess.Popen(
        ['chromium', '--headless=new', '--remote-debugging-port=%d' % PORT, '--no-sandbox',
         '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
         '--remote-allow-origins=*',
         '--window-size=%d,%d' % (W, H), 'about:blank'],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(60):
        if up():
            break
        time.sleep(0.2)

targets = json.load(urllib.request.urlopen('http://127.0.0.1:%d/json' % PORT))
page = [t for t in targets if t['type'] == 'page'][0]
ws = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=60, suppress_origin=True)
mid = 0


def send(method, **params):
    global mid
    mid += 1
    ws.send(json.dumps({'id': mid, 'method': method, 'params': params}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get('id') == mid:
            if 'error' in msg:
                raise RuntimeError(msg['error'])
            return msg.get('result', {})


send('Page.enable')
send('Emulation.setDeviceMetricsOverride', width=W, height=H, deviceScaleFactor=1, mobile=False)
send('Page.navigate', url=url)
time.sleep(0.7)

t0 = time.time()
for t in times:
    while time.time() - t0 < t:
        time.sleep(0.03)
    r = send('Page.captureScreenshot', format='png', captureBeyondViewport=False)
    name = '%s-%s.png' % (prefix, ('%g' % t))
    with open(name, 'wb') as f:
        f.write(base64.b64decode(r['data']))
    st = send('Runtime.evaluate', expression="document.body.className", returnByValue=True)
    print('已存 %-24s 阶段: %s' % (name, st['result']['value'] or '(无)'))

# 顺带把页面状态与最终跳转地址取回来
res = send('Runtime.evaluate', expression=(
    "JSON.stringify({cls:document.body.className,url:location.href,"
    "nl:(document.querySelector('.nl-img')||{}).currentSrc||'',"
    "nw:(document.querySelector('.nl-img')||{}).naturalWidth||0})"),
    returnByValue=True)
print('状态:', res['result']['value'])
ws.close()
