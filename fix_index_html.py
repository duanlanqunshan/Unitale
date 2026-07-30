import re

# 读取原始文件
with open('G:/AI/Unitale/repo/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 替换 picsum 背景为本地梯度
old_body_style = '''        /* 随机背景与毛玻璃特效 */
        body {
            background-color: #f1f5f9;
            /* Fallback color */
            background-image: url('https://picsum.photos/1920/1080');
            background-size: cover;
            background-position: center;
            background-attachment: fixed;
        }'''

new_body_style = '''        /* 随机背景与毛玻璃特效 */
        body {
            background-color: #f1f5f9;
            /* Fallback color */
            background-image: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%);
            background-size: cover;
            background-position: center;
            background-attachment: fixed;
        }'''

if old_body_style in content:
    content = content.replace(old_body_style, new_body_style)
    print("Replaced picsum background with gradient")
else:
    # 尝试另一种格式
    content = content.replace("background-image: url('https://picsum.photos/1920/1080');", "background-image: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%);")
    print("Replaced picsum URL directly")

# 写入文件
with open('G:/AI/Unitale/repo/index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("File updated successfully!")