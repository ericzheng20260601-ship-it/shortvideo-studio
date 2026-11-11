#!/usr/bin/env python3
"""生成资料库门户页的只读快照产物。

用途：把 Node 服务端当天的「每日发现」榜单内嵌进 deploy/library-portal.html，
产出 deploy/out/library-portal.html 供导入/重导资料库页面节点。

凭据只从环境变量读取，不落盘、不写进产物：
  SV_BASE             Node 服务根地址，如 https://studio.example.com
  SV_PORTAL_TARGET    成员点击「进入工作台」的完整 URL（含分享码，如有）
  SV_GATE_QUERY       网关准入参数，如 sharecode=XXXX（可选，用于先拿网关 Cookie）
  SV_ADMIN_EMAIL      管理员邮箱
  SV_ADMIN_PASSWORD   管理员密码
  SV_TOKEN            已有服务端令牌（与上面二选一，可跳过登录）

失败一律非零退出且不生成产物，绝不用示例数字填充快照。
"""
import http.cookiejar
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / 'deploy' / 'library-portal.html'
OUTPUT = ROOT / 'deploy' / 'out' / 'library-portal.html'


def env(name, default=''):
    return os.environ.get(name, default).strip()


def request(opener, url, payload=None, headers=None):
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode()
    req = urllib.request.Request(
        url, data=data, method='GET' if payload is None else 'POST',
        headers={'Accept': 'application/json', **(headers or {})}
    )
    if data is not None:
        req.add_header('Content-Type', 'application/json')
    with opener.open(req, timeout=25) as response:
        return json.loads(response.read().decode('utf-8'))


def touch(opener, url):
    """只取首页以建立平台网关 Cookie，不解析响应体（首页是 HTML）。"""
    req = urllib.request.Request(url, method='GET')
    with opener.open(req, timeout=25) as response:
        return response.status


def main():
    base = env('SV_BASE').rstrip('/')
    target = env('SV_PORTAL_TARGET')
    email = env('SV_ADMIN_EMAIL')
    password = env('SV_ADMIN_PASSWORD')
    token = env('SV_TOKEN')
    gate = env('SV_GATE_QUERY').lstrip('?')

    if not base or not target:
        print('[fail] 需要 SV_BASE 与 SV_PORTAL_TARGET', file=sys.stderr)
        return 2
    if not token and not (email and password):
        print('[fail] 需要 SV_TOKEN 或 SV_ADMIN_EMAIL + SV_ADMIN_PASSWORD', file=sys.stderr)
        return 2

    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    # 平台网关会先种准入 Cookie；不带它 API 会 403。
    if gate:
        try:
            touch(opener, base + '/?' + gate)
        except Exception as exc:
            print('[fail] 网关准入失败: %s' % exc, file=sys.stderr)
            return 3

    if not token:
        try:
            login = request(opener, base + '/api/auth/login',
                            {'email': email, 'password': password})
            token = login.get('token', '')
        except Exception as exc:
            print('[fail] 登录失败: %s' % exc, file=sys.stderr)
            return 3
    if not token:
        print('[fail] 未取得服务端令牌', file=sys.stderr)
        return 3

    auth = {'X-SV-Token': token, 'Authorization': 'Bearer ' + token}
    try:
        board = request(opener, base + '/api/discover/board?type=hot&limit=8', headers=auth)
    except Exception as exc:
        print('[fail] 榜单读取失败: %s' % exc, file=sys.stderr)
        return 4

    stats = board.get('stats') or {}
    source = stats.get('source') or 'unknown'
    rows = board.get('items') or []
    items = []
    for row in rows[:8]:
        place = row.get('country') or '—'
        category = row.get('category') or '—'
        metric = '热度 %s · 播放 %s' % (
            row.get('heat') if row.get('heat') is not None else '—',
            row.get('views') if row.get('views') is not None else '—'
        )
        items.append({
            'title': row.get('title') or row.get('product') or '—',
            'category': '%s · %s' % (category, place),
            'metric': metric
        })

    tz = timezone(timedelta(hours=8))
    snapshot = {
        'updatedAt': '%s（数据日 %s）' % (
            datetime.now(tz).strftime('%Y-%m-%d %H:%M'), board.get('day') or '—'),
        'source': source,
        'items': items
    }

    html = TEMPLATE.read_text(encoding='utf-8')
    url_block = re.search(r"var STUDIO_URL = '[^']*';", html)
    snap_block = re.search(r"var SNAPSHOT = \{.*?\n\};", html, re.S)
    if not url_block or not snap_block:
        print('[fail] 模板缺少 STUDIO_URL / SNAPSHOT 常量块', file=sys.stderr)
        return 5

    html = html.replace(url_block.group(0),
                        "var STUDIO_URL = %s;" % json.dumps(target, ensure_ascii=False))
    html = html.replace(
        snap_block.group(0),
        'var SNAPSHOT = %s;' % json.dumps(snapshot, ensure_ascii=False, indent=2)
    )

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(html, encoding='utf-8')
    print('[ok] %s' % OUTPUT.relative_to(ROOT))
    print('[ok] 快照 %d 条 · 来源 %s · 数据日 %s' % (len(items), source, board.get('day')))
    if source in ('demo', 'local', 'unknown'):
        print('[note] 当前数据源为演示 / 本地，页面会标注来源，不伪装真实平台读数。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
