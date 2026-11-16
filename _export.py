# -*- coding: utf-8 -*-
import openpyxl, json, datetime, os

BASE = r'C:\Users\haodejin\Desktop\管道应用\data'
os.makedirs(BASE, exist_ok=True)

def norm(v):
    if v is None:
        return ''
    if isinstance(v, datetime.datetime):
        return v.strftime('%Y-%m-%d')
    if isinstance(v, datetime.date):
        return v.isoformat()
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)

def clean(c):
    """规范化列名：换行/多余空白合并为单个空格"""
    return ' '.join(str(c).replace('\n', ' ').replace('\r', ' ').split())

def dedupe(cols):
    """给重名列加后缀消歧，空表头给占位名"""
    seen, out = {}, []
    for i, raw in enumerate(cols):
        c = clean(raw)
        if not c:
            c = '未命名%d' % (i + 1)
        if c in seen:
            seen[c] += 1
            c = '%s(%d)' % (c, seen[c])
        else:
            seen[c] = 0
        out.append(c)
    return out

def trim_row(row):
    """裁掉尾部连续空值以压缩体积"""
    end = len(row)
    while end > 0 and row[end - 1] == '':
        end -= 1
    return row[:end]

def write_js(varname, cols, rows, filename):
    obj = {'cols': cols, 'rows': rows}
    text = 'window.%s=' % varname + json.dumps(obj, ensure_ascii=False, separators=(',', ':')) + ';'
    path = os.path.join(BASE, filename)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)
    print(filename, 'rows=', len(rows), 'cols=', len(cols), 'size=%.1fMB' % (len(text.encode('utf-8')) / 1048576))

# ---------- 管线 ----------
wb = openpyxl.load_workbook(r'C:\Users\haodejin\Desktop\管线.xlsx', read_only=True, data_only=True)
ws = wb.active
it = ws.iter_rows(values_only=True)
header = next(it)
cols = [clean(norm(v)) for v in header]
# 末尾空表头命名为占位并保持（数据列仍对齐），后面 dedupe 统一处理
cols = dedupe(cols)
ncol = len(cols)
rows = []
for r in it:
    vals = [norm(v) for v in r[:ncol]]
    rows.append(trim_row(vals))
wb.close()
write_js('PIPELINE_DATA', cols, rows, 'pipeline.js')

# ---------- 支架 ----------
wb = openpyxl.load_workbook(r'C:\Users\haodejin\Desktop\C19 Support database支架制作状态报表.xlsx', read_only=True, data_only=True)
ws = wb.active
it = ws.iter_rows(values_only=True)
rows_all = list(it)
cols = dedupe([clean(norm(v)) for v in rows_all[1]])  # 第2行中文表头
ncol = len(cols)
rows = []
for r in rows_all[3:]:  # 数据从第4行
    vals = [norm(v) for v in r[:ncol]]
    if not any(vals):
        continue
    rows.append(trim_row(vals))
wb.close()
write_js('SUPPORT_DATA', cols, rows, 'support.js')

# ---------- 阀门 ----------
wb = openpyxl.load_workbook(r'C:\Users\haodejin\Desktop\阀门数据库.xlsx', read_only=True, data_only=True)
ws = wb.active
it = ws.iter_rows(values_only=True)
header = next(it)
cols = []
import re
def valve_name(s):
    s = clean(norm(s))
    s = re.sub(r'[А-Яа-яЁё]', '', s).replace('№','').replace('*','')
    toks = s.split()
    # 去掉开头不含中文的 token（俄文残留/序号/ISO 等前缀）
    while toks and not re.search(r'[\u4e00-\u9fff]', toks[0]):
        toks.pop(0)
    return ' '.join(toks).strip() or s
for v in header:
    cols.append(valve_name(v))
cols = dedupe(cols)
ncol = len(cols)
rows = []
for r in it:
    vals = [norm(v) for v in r[:ncol]]
    if not any(vals):
        continue
    rows.append(trim_row(vals))
wb.close()
write_js('VALVE_DATA', cols, rows, 'valve.js')

print('DONE')
