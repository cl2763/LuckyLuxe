"""Build LUVIA metallic-slice proof and vector separations, millimetres throughout."""
from pathlib import Path
import xml.etree.ElementTree as ET
import re, math, random, json, hashlib, zipfile, shutil
from reportlab.pdfgen import canvas
from reportlab.lib.colors import Color, HexColor, CMYKColorSep
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader
from pypdf import PdfReader, PdfWriter
from pypdf.generic import RectangleObject

ROOT = Path('/Users/changliu/Documents/Codex/2026-04-29/new-chat')
OUT = ROOT / 'deliverables/LUVIA_金属切片_70x65mm_交厂包_v1'
SRC = Path('/Users/changliu/Desktop/LUVIA_半径_品牌视觉资产包 3/01_LOGO_标志系统/04_单色_黑/A1_主LOGO-完整版.svg')
REF = Path('/Users/changliu/.codex/generated_images/01a06828-f026-76f0-b83a-faadf8affad5/exec-901d353e-e37e-4863-ae20-764878baeaf6.png')
MM = 72 / 25.4
W, H, BLEED = 70, 65, 2
INK = CMYKColorSep(.0, .285, .49, .77, spotName='LUVIA_Espresso')
CUT = CMYKColorSep(0, 1, 0, 0, spotName='CutContour')
RELIEF = CMYKColorSep(1, 0, 0, 0, spotName='TextureRelief')
MASK = CMYKColorSep(0, 0, 1, 0, spotName='TextureArea')
CONTOUR = 'M40 0 C48 0 55 6 60 11 L64 15 C68 24 70 34 70 42 C70 56 58 65 41 65 C22 65 8 58 2 45 C0 40 0 35 0 31 C0 17 12 7 27 2 C31 1 36 0 40 0 Z'
ZONE = 'M0 0 L40 0 C37 12 26 26 15 35 C10 39 6 42 2 45 L0 45 Z'

def parse(d):
    tok = re.findall(r'[MLHVQCZ]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?', d)
    out=[]; i=0; cmd=None; x=y=0; start=(0,0)
    arity={'M':2,'L':2,'H':1,'V':1,'Q':4,'C':6}
    while i<len(tok):
        if tok[i].isalpha():
            cmd=tok[i];i+=1
            if cmd=='Z':out.append(('Z',));x,y=start;continue
        n=arity[cmd]; a=list(map(float,tok[i:i+n])); i+=n
        if cmd in ('M','L'):
            x,y=a;out.append((cmd,x,y))
            if cmd=='M':start=(x,y);cmd='L'
        elif cmd=='H':x=a[0];out.append(('L',x,y))
        elif cmd=='V':y=a[0];out.append(('L',x,y))
        elif cmd=='Q':
            qx,qy,nx,ny=a
            out.append(('C',x+2/3*(qx-x),y+2/3*(qy-y),nx+2/3*(qx-nx),ny+2/3*(qy-ny),nx,ny));x,y=nx,ny
        elif cmd=='C':out.append(('C',*a));x,y=a[-2:]
    return out

def points(ops, n=24):
    out=[];cur=(0,0);start=(0,0)
    for op in ops:
        if op[0] in ('M','L'):
            cur=op[1:];out.append(cur)
            if op[0]=='M':start=cur
        elif op[0]=='C':
            p0=cur;p1=op[1:3];p2=op[3:5];p3=op[5:7]
            for j in range(1,n+1):
                t=j/n;u=1-t
                out.append(tuple(u**3*p0[k]+3*u*u*t*p1[k]+3*u*t*t*p2[k]+t**3*p3[k] for k in (0,1)))
            cur=p3
        else:out.append(start);cur=start
    return out

def bounds(pts):
    return min(p[0] for p in pts),min(p[1] for p in pts),max(p[0] for p in pts),max(p[1] for p in pts)

def path(c,ops):
    p=c.beginPath()
    for op in ops:
        if op[0]=='M':p.moveTo(*op[1:])
        elif op[0]=='L':p.lineTo(*op[1:])
        elif op[0]=='C':p.curveTo(*op[1:])
        else:p.close()
    return p

def inside(p,poly):
    x,y=p;b=False
    for a,z in zip(poly,poly[1:]+poly[:1]):
        if (a[1]>y)!=(z[1]>y) and x<(z[0]-a[0])*(y-a[1])/(z[1]-a[1])+a[0]:b=not b
    return b

def distseg(p,a,b):
    dx=b[0]-a[0];dy=b[1]-a[1];v=dx*dx+dy*dy
    t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/v)) if v else 0
    return math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)

def boundary_dist(p,poly):return min(distseg(p,a,b) for a,b in zip(poly,poly[1:]+poly[:1]))

tree=ET.parse(SRC).getroot()
RAW=[e.attrib['d'] for e in tree if e.tag.endswith('path')]
LOGO=[parse(d) for d in RAW]
B=bounds([p for ops in LOGO for p in points(ops)])
LX,LY,LW=24.5,25.0,40.5
S=LW/(B[2]-B[0]);LH=(B[3]-B[1])*S
CP=points(parse(CONTOUR),60);ZP=points(parse(ZONE),60)

def logo_points():
    return [(LX+(x-B[0])*S,LY+(y-B[1])*S) for ops in LOGO for x,y in points(ops,20)]

def halfclip(poly,ax,ay,k):
    result=[]
    for a,b in zip(poly,poly[1:]+poly[:1]):
        fa=ax*a[0]+ay*a[1]-k;fb=ax*b[0]+ay*b[1]-k
        if fa<=0:result.append(a)
        if (fa<=0)!=(fb<=0):
            t=fa/(fa-fb);result.append((a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])))
    return result

def relief_cells():
    rng=random.Random(7691)
    seeds=[(i*1.6+rng.uniform(-.48,.48),j*1.6+rng.uniform(-.48,.48)) for j in range(-2,32) for i in range(-2,29)]
    cells=[]
    for x,y in seeds:
        if not inside((x,y),CP) or not inside((x,y),ZP):continue
        poly=[(x-2,y-2),(x+2,y-2),(x+2,y+2),(x-2,y+2)]
        for a,b in seeds:
            if 0<(a-x)**2+(b-y)**2<18:
                poly=halfclip(poly,a-x,b-y,(a*a+b*b-x*x-y*y)/2)
                if len(poly)<3:break
        poly=[(x+.67*(a-x),y+.67*(b-y)) for a,b in poly]
        if len(poly)<3:continue
        if any(not inside(v,CP) or not inside(v,ZP) or boundary_dist(v,CP)<.65 or boundary_dist(v,ZP)<.45 for v in poly):continue
        mids=[((a[0]+b[0])/2,(a[1]+b[1])/2) for a,b in zip(poly,poly[1:]+poly[:1])]
        d=f'M{mids[-1][0]:.4f} {mids[-1][1]:.4f} '
        for v,m in zip(poly,mids):d+=f'Q{v[0]:.4f} {v[1]:.4f} {m[0]:.4f} {m[1]:.4f} '
        cells.append(d+'Z')
    return cells

CELLS=relief_cells()
NS='http://www.inkscape.org/namespaces/inkscape'
def svg_logo(color='#3B2A1E'):
    return f'<g transform="translate({LX} {LY}) scale({S:.12f}) translate({-B[0]:.8f} {-B[1]:.8f})" fill="{color}">' + ''.join(f'<path d="{d}"/>' for d in RAW)+'</g>'

def layer(name,body,hidden=False):
    return f'<g id="{name}" inkscape:groupmode="layer" inkscape:label="{name}"'+(' style="display:none"' if hidden else '')+'>'+body+'</g>'

def svg_plate(mode):
    head=f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="{NS}" width="74mm" height="69mm" viewBox="-2 -2 74 69">'
    defs=f'<defs><clipPath id="cut"><path d="{CONTOUR}"/></clipPath><clipPath id="zone"><path d="{ZONE}"/></clipPath></defs>'
    bg=f'<path d="{CONTOUR}" fill="#BFA16B" stroke="#BFA16B" stroke-width="4" stroke-linejoin="round"/>'
    cut=f'<path d="{CONTOUR}" fill="none" stroke="#FF00FF" stroke-width="0.10"/>'
    mask=f'<g clip-path="url(#cut)"><path d="{ZONE}" fill="#FFDC00"/></g>'
    cells='<g fill="none" stroke="#00A6BE" stroke-width="0.20" stroke-linejoin="round">'+''.join(f'<path d="{d}"/>' for d in CELLS)+'</g>'
    if mode=='master':
        body=layer('00_MetallicStock_PREVIEW_ONLY',bg,True)+layer('01_LUVIA_Espresso_PRINT',svg_logo())+layer('02_TextureRelief_EMBOSS_NOT_INK',cells)+layer('03_TextureArea_REFERENCE_ONLY',mask,True)+layer('04_CutContour_DIE_NOT_INK',cut)
    elif mode=='ink':body=layer('LUVIA_Espresso',svg_logo())
    elif mode=='cut':body=layer('CutContour',cut)
    elif mode=='relief':body=layer('TextureRelief',cells)
    elif mode=='mask':body=layer('TextureArea',mask)
    else:
        # Flat proof deliberately uses vector geometry, not the generated photo.
        body=f'<path d="{CONTOUR}" fill="#C3A36A"/>'
        body+='<g fill="none" stroke="#977846" stroke-width="0.13">'+''.join(f'<path d="{d}"/>' for d in CELLS)+'</g>'+svg_logo()
    return head+defs+body+'</svg>'

def draw_logo(c,ink=INK):
    c.saveState();c.translate(LX,LY);c.scale(S,S);c.translate(-B[0],-B[1]);c.setFillColor(ink)
    for ops in LOGO:c.drawPath(path(c,ops),stroke=0,fill=1,fillMode=1)
    c.restoreState()

def draw_design(c,mode):
    if mode=='preview':
        c.setFillColor(HexColor('#C3A36A'));c.drawPath(path(c,parse(CONTOUR)),stroke=0,fill=1)
        c.setStrokeColor(HexColor('#967748'));c.setLineWidth(.13)
        for d in CELLS:c.drawPath(path(c,parse(d)),stroke=1,fill=0)
        draw_logo(c,HexColor('#3B2A1E'))
    elif mode=='ink':draw_logo(c)
    elif mode=='cut':
        c.setStrokeColor(CUT);c.setLineWidth(.1);c.setStrokeOverprint(True)
        c.drawPath(path(c,parse(CONTOUR)),stroke=1,fill=0)
    elif mode=='relief':
        c.setStrokeColor(RELIEF);c.setLineWidth(.2)
        for d in CELLS:c.drawPath(path(c,parse(d)),stroke=1,fill=0)
    elif mode=='mask':
        c.clipPath(path(c,parse(CONTOUR)),stroke=0,fill=0);c.setFillColor(MASK)
        c.drawPath(path(c,parse(ZONE)),stroke=0,fill=1)

def plate(filename,mode):
    dst=OUT/filename;c=canvas.Canvas(str(dst),pagesize=(74*MM,69*MM),pageCompression=1)
    c.setTitle('LUVIA 70x65mm - '+mode+' - 1:1');c.setAuthor('LUVIA')
    c.saveState();c.translate(2*MM,67*MM);c.scale(MM,-MM);draw_design(c,mode);c.restoreState();c.save()
    r=PdfReader(dst);w=PdfWriter();page=r.pages[0]
    page.trimbox=RectangleObject([2*MM,2*MM,72*MM,67*MM]);page.bleedbox=RectangleObject([0,0,74*MM,69*MM])
    w.add_page(page);w.add_metadata({'/Title':'LUVIA '+mode+' 70x65mm 2mm bleed'})
    with dst.open('wb') as f:w.write(f)

FONT='/System/Library/Fonts/Supplemental/Arial Unicode.ttf'
pdfmetrics.registerFont(TTFont('CN',FONT))

def txt(c,x,y,t,size=10,color='#352E25'):
    c.setFillColor(HexColor(color));c.setFont('CN',size);c.drawString(x*MM,(297-y)*MM,t)

def line(c,x1,y1,x2,y2,color='#CEC4B4',width=.25):
    c.setStrokeColor(HexColor(color));c.setLineWidth(width*MM);c.line(x1*MM,(297-y1)*MM,x2*MM,(297-y2)*MM)

def design_at(c,x,y,scale=1,mode='preview'):
    c.saveState();c.translate(x*MM,(297-y)*MM);c.scale(MM*scale,-MM*scale);draw_design(c,mode);c.restoreState()

def footer(c,n):
    line(c,17,282,193,282);txt(c,17,288,'LUVIA 半径 / 金属切片 / V1 / 2026-09-05',8,'#877B69');txt(c,180,288,f'{n} / 3',8,'#877B69')

def header(c,k,title,sub):
    txt(c,17,18,k,9,'#9A794B');txt(c,17,30,title,21);txt(c,17,40,sub,9,'#877B69');line(c,17,46,193,46)

def guide():
    c=canvas.Canvas(str(OUT/'00_制作规格与定位说明.pdf'),pagesize=(210*MM,297*MM))
    c.setTitle('LUVIA 金属切片贴纸 制作规格与定位说明')
    header(c,'01 / DESIGN','金属切片 · 70 × 65 mm','正面观看方向 / 尺寸单位 mm / 以矢量刀线为准')
    design_at(c,29,65,1.9)
    # Dimensions around the enlarged drawing.
    line(c,29,58,162,58,'#86755F');line(c,29,55.5,29,61,'#86755F');line(c,162,55.5,162,61,'#86755F');txt(c,86,56,'70 mm',10)
    line(c,173,65,173,188.5,'#86755F');line(c,170,65,176,65,'#86755F');line(c,170,188.5,176,188.5,'#86755F');txt(c,176,129,'65',10)
    txt(c,17,205,'Logo 调整',12)
    txt(c,17,215,f'完整 Logo 外接框：{LW:.1f} × {LH:.2f} mm；保持原始字形与整体比例。',10)
    txt(c,17,224,f'定位：距成品外接框左边 {LX:.1f} mm，距上边 {LY:.1f} mm。',10)
    txt(c,17,233,'设计调整基准：宽 36.5 → 40.5 mm（约 +11%）；顶边上移 4 mm。',10)
    txt(c,17,242,'基准为本次矢量排版对照值，上一张 AI 效果图不具备精确坐标。',8.5,'#877B69')
    txt(c,17,253,'左侧肌理独立成版；Logo 曲线未进入肌理区。金色仅为屏幕示意。',9)
    txt(c,17,263,'选款依据：上一轮最后一张「弧形金属切片」，不是 D 撕边款。',9)
    footer(c,1);c.showPage()

    header(c,'02 / PRODUCTION','材料、分版与加工','本包用于厂家核价、制版与实物打样；不等同于已确认的机器生产参数')
    rows=[
        ('底材','哑香槟金不干胶；优先询可做局部浅压纹的金箔复合纸。'),
        ('胶黏剂','按实际白色褶皱盒纸选胶；用同款盒面试贴确认附着与翘边。'),
        ('Logo 印刷','单专色深棕 LUVIA_Espresso；色样以实物签样为准。'),
        ('肌理','局部浅压纹；本包提供可编辑的纹理线稿与独立范围图。'),
        ('纹理线宽','线稿为 0.20 mm；由模具厂按纸材调整压深、肩角和疏密。'),
        ('模切','沿 CutContour 闭合刀线半穿切，仅切面材与胶层，保留底纸。'),
        ('文件尺寸','成品外接框 70 × 65；四边预留 2；分版画板 74 × 69。'),
        ('出血含义','使用整面金色底材无需印金底；隐藏金底层仅作外观参考。'),
        ('禁止误印','品红刀线、青色肌理版、黄色范围版均不是成品印刷颜色。'),
        ('生产前确认','金色光泽、棕墨附着、细线完整度、压纹效果与胶黏性。')]
    y=58
    for a,b in rows:
        txt(c,17,y,a,10);txt(c,49,y,b,9);line(c,17,y+5,193,y+5,'#E6E0D6',.18);y+=16
    txt(c,17,226,'关于 Logo 细线',12)
    txt(c,17,236,'直接引用资产包 A1 曲线，未重打字、未擅自描粗。细线局部约 0.06-0.12 mm，',9)
    txt(c,17,244,'小字主笔画约 0.11-0.12 mm。请厂家先确认本机印刷能力并打样。',9)
    txt(c,17,255,'若印不清：先反馈，再选用品牌官方加粗版；不得由厂家随意重描。',9)
    txt(c,17,265,'纹理线稿是对效果图的可制造化设计，不保证复制照片中的随机金属反光。',8.5,'#877B69')
    footer(c,2);c.showPage()

    header(c,'03 / APPLICATION','大方盒定位与交厂清单','盒体外尺寸 175 × 180 × 70 mm；以下为正面平视尺寸关系')
    # 0.62 scale box and true-size proportional sticker layout.
    bx,by,k=18,60,.62
    c.setFillColor(HexColor('#F4F1EB'));c.setStrokeColor(HexColor('#A49A8A'));c.setLineWidth(.6)
    c.rect(bx*MM,(297-by-180*k)*MM,175*k*MM,180*k*MM,stroke=1,fill=1)
    design_at(c,bx+52.5*k,by+50.5*k,k)
    line(c,bx,by+90*k,bx+175*k,by+90*k,'#AA9980',1)
    txt(c,132,66,'贴纸定位建议',12)
    for j,t in enumerate(['左边距：52.5 mm','上边距：50.5 mm','中心：X87.5 / Y83.0','贴纸右边距：52.5 mm','下边距：64.5 mm','横绳参考线：Y90 mm']):txt(c,132,78+j*10,t,9)
    txt(c,18,181,'示意图按相同比例绘制；绳位应以实际绑扎为准。',8.5,'#877B69')
    txt(c,17,195,'交厂文件用途',12)
    for j,t in enumerate([
        '01 分层主文件.svg：可编辑矢量；默认显示 Logo、肌理线、刀线。',
        '02 Logo印刷版.pdf / .svg：仅印深棕 Logo，透明背景，无金色底。',
        '03 模切刀线.pdf / .svg：闭合外轮廓，专色 CutContour。',
        '04 肌理线稿.pdf / .svg：局部压纹图案；青色为工艺版标识。',
        '05 肌理范围.pdf / .svg：仅限定加工区域；不是另一道满版压纹。',
        '06 1比1剪贴纸样.pdf：A4，按实际大小/100%打印后剪下试贴。']):txt(c,17,206+j*10,t,9)
    txt(c,17,270,'绳结建议偏右避开 Logo；印刷文件不含绑绳。',9)
    footer(c,3);c.save()

def paper_proof():
    c=canvas.Canvas(str(OUT/'06_1比1剪贴纸样_A4.pdf'),pagesize=(210*MM,297*MM))
    txt(c,18,22,'LUVIA 金属切片 / 1:1 实际尺寸纸样',17)
    txt(c,18,33,'请选择「实际大小 / 100%」，关闭「适合页面」；普通纸打印后剪下试贴。',10)
    design_at(c,25,54);design_at(c,115,54,mode='cut')
    txt(c,25,130,'外观纸样 70 × 65 mm',10);txt(c,115,130,'刀形核对 70 × 65 mm',10)
    txt(c,18,155,'校准线：打印后用尺量下方横线，必须等于 100 mm。',10)
    line(c,25,168,125,168,'#222222',.2);line(c,25,165,25,171,'#222222',.2);line(c,125,165,125,171,'#222222',.2);txt(c,68,178,'100 mm',10)
    txt(c,18,200,'建议贴纸左上角：距盒面左边 52.5 mm、上边 50.5 mm。',10)
    txt(c,18,212,'请同时试绑绳结，确认字标不被遮挡。',10)
    txt(c,18,229,'纸样用于尺寸与位置确认；纸上金色不能代表金属底材的反射效果。',9,'#877B69')
    c.save()

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    for mode,name in [('master','01_分层主文件'),('ink','02_Logo印刷版'),('cut','03_模切刀线'),('relief','04_肌理线稿'),('mask','05_肌理范围')]:
        (OUT/(name+'.svg')).write_text(svg_plate(mode),encoding='utf-8')
        if mode!='master':plate(name+'.pdf',mode)
    (OUT/'07_平面外观预览.svg').write_text(svg_plate('preview'),encoding='utf-8')
    qa=ROOT/'tmp/luvia-sticker-qa';qa.mkdir(parents=True,exist_ok=True)
    c=canvas.Canvas(str(qa/'flat-preview.pdf'),pagesize=(74*MM,69*MM))
    c.translate(2*MM,67*MM);c.scale(MM,-MM);draw_design(c,'preview');c.save()
    guide();paper_proof()
    shutil.copy2(SRC,OUT/'08_原始Logo_A1_只读参考.svg')
    shutil.copy2(REF,OUT/'09_选款依据_调整前效果图.png')
    lp=logo_points()
    violations=[p for p in lp if not inside(p,CP)]
    overlap=[p for p in lp if inside(p,ZP)]
    mincut=min(boundary_dist(p,CP) for p in lp)
    minzone=min(boundary_dist(p,ZP) for p in lp)
    stats={'version':'1.0','selected_design':'last generated image: metallic slice, not torn-edge D','finished_mm':[70,65],'bleed_mm':2,'artboard_mm':[74,69],'units':'mm','origin':'top-left of finished bounding rectangle; +X right, +Y down','logo_source':str(SRC),'logo_source_sha256':hashlib.sha256(SRC.read_bytes()).hexdigest(),'source_path_count':len(RAW),'logo_bbox_mm':{'x':LX,'y':LY,'width':LW,'height':round(LH,4)},'logo_scale_uniform':S,'logo_source_bounds':B,'comparison_layout_only':{'previous_width_mm':36.5,'previous_top_mm':29,'scale_increase_percent':round((LW/36.5-1)*100,2),'top_shift_mm':-4},'minimum_sampled_logo_to_cut_mm':round(mincut,3),'minimum_sampled_logo_to_texture_zone_mm':round(minzone,3),'logo_outside_cut_samples':len(violations),'logo_in_texture_zone_samples':len(overlap),'texture_cell_count':len(CELLS),'texture_stroke_mm':.2,'texture_is':'shallow emboss artwork; polarity/depth to be set by die maker, not printed cyan','cut_path_svg':CONTOUR,'texture_zone_path_svg':ZONE,'box_mm':[175,180,70],'suggested_label_top_left_on_box_mm':[52.5,50.5],'suggested_label_center_on_box_mm':[87.5,83],'color_reference':{'ink_spot':'LUVIA_Espresso','ink_screen_hex':'#3B2A1E','stock':'matte champagne gold adhesive foil-laminated paper; physical sample controls'}}
    (OUT/'10_尺寸与分版数据.json').write_text(json.dumps(stats,ensure_ascii=False,indent=2),encoding='utf-8')
    assert not violations, ('Logo outside contour',len(violations))
    assert not overlap, ('Logo overlaps texture',len(overlap))
    assert mincut>2, mincut
    # Verify supplied paths are literally preserved in all generated SVG logo layers.
    for name in ['01_分层主文件.svg','02_Logo印刷版.svg']:
        r=ET.parse(OUT/name).getroot();ds=[e.attrib['d'] for e in r.iter() if e.tag.endswith('path')]
        assert all(d in ds for d in RAW)
        assert not any(e.tag.endswith('text') or e.tag.endswith('image') for e in r.iter())
    checks=[]
    for p in OUT.glob('*.pdf'):
        r=PdfReader(p);xobj=0
        for page in r.pages:
            resources=page.get('/Resources',{})
            for o in resources.get('/XObject',{}).values():
                if o.get_object().get('/Subtype')=='/Image':xobj+=1
        checks.append({'file':p.name,'pages':len(r.pages),'image_objects':xobj,'media_mm':[round(float(r.pages[0].mediabox.width)/MM,3),round(float(r.pages[0].mediabox.height)/MM,3)]})
    stats['pdf_checks']=checks
    (OUT/'10_尺寸与分版数据.json').write_text(json.dumps(stats,ensure_ascii=False,indent=2),encoding='utf-8')
    (OUT/'README_给厂家先看.txt').write_text(f'''LUVIA 半径 金属切片不干胶 / V1

选款：最后一张白色大方盒上的弧形金属切片，不是 D 撕边。
成品最大外接尺寸 70 × 65 mm。2 mm 预留，所有分版画板统一 74 × 69 mm。
SVG 与 PDF 为矢量。Logo 直接引用资产包 A1 的全部 {len(RAW)} 条路径，未重新打字。
Logo 实际外接框 {LW} × {LH:.2f} mm，左上角 X{LX} / Y{LY}。
以本次旧排版宽36.5 / 顶29为对照，放大约11%，上移4mm；效果图并无精确旧坐标。
Logo 与左侧肌理区域不相交，采样最小间距 {minzone:.2f} mm；离刀线最小间距 {mincut:.2f} mm。

报价/打样建议：哑香槟金不干胶复合纸 + 单专色深棕 Logo + 左侧局部浅压纹 + 异形半穿模切。
金色是底材，不要把屏幕金色按 CMYK 印一遍。Logo 不需再烫金。
04 为可编辑纹理线稿；05 只是区域限制图，不要做成整块实心压纹。
纹理为0.20mm线条，实际模具肩角、正反向、压深及材质适配请厂家打样确认。
Logo 局部细线约0.06-0.12mm；先确认印刷能力，不得擅自描粗。若需加粗应反馈后选官方 B1 版本。
PDF包含真实专色分色；SVG图层名用于识别工艺，SVG色值本身不是PDF专色。
01 主文件的金色底材预览层和黄色肌理范围层默认隐藏。
生产时严禁把刀线、肌理工艺版、范围图作为彩色图案印到成品上。
不宣称此文件为PDF/X认证或已完成设备RIP验证。厂方应核对1:1尺寸及分版后打样。

盒面175 × 180mm。建议贴纸左上角距盒面左52.5mm、上50.5mm。
请用06的A4纸样按100%打印，先量100mm校准线，再剪下试贴。绳结建议偏右。
09是调整前AI选款依据；07及生产矢量才是本轮调整后的排版。
胶水需针对实际褶皱盒面确认附着，先试贴再批量。

文件：00制作说明；01分层SVG；02印刷版；03刀线；04压纹图案；05区域；06纸样；07平面预览；08原Logo；09选款参考；10数据。
''',encoding='utf-8')
    print(json.dumps(stats,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
