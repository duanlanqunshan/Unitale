import re

# 读取文件
with open('G:/AI/Unitale/repo/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. 替换 Head 部分：Tailwind、Vue、mp4-muxer 增加多源 fallback
old_head = '''    <title>unitale ai工具</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://unpkg.com/vue@3/dist/vue.global.js"></script>
    <script src="https://unpkg.com/mp4-muxer/build/mp4-muxer.js"></script>
    <script src="./vendor/ffmpeg/ffmpeg.js"></script>
    <script src="./vendor/ffmpeg/util.js"></script>'''

new_head = '''    <title>unitale ai工具</title>
    <!-- Tailwind CSS with fallback -->
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        if (typeof tailwind === 'undefined') {
            document.write('<script src="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.js"><\/script>');
        }
    </script>
    
    <!-- Vue 3 with multi-CDN fallback -->
    <script src="https://cdn.bootcdn.net/ajax/libs/vue/3.3.4/vue.global.js"></script>
    <script>
        if (typeof Vue === 'undefined') {
            document.write('<script src="https://cdn.jsdelivr.net/npm/vue@3/dist/vue.global.js"><\/script>');
        }
        if (typeof Vue === 'undefined') {
            document.write('<script src="https://unpkg.com/vue@3/dist/vue.global.js"><\/script>');
        }
        if (typeof Vue === 'undefined') {
            document.write('<script src="vendor/vue/vue.js"><\/script>');
        }
    </script>
    
    <!-- mp4-muxer with multi-CDN fallback -->
    <script src="https://cdn.bootcdn.net/ajax/libs/mp4-muxer/1.1.2/mp4-muxer.js"></script>
    <script>
        if (typeof Mp4Muxer === 'undefined') {
            document.write('<script src="https://cdn.jsdelivr.net/npm/mp4-muxer@1.1.2/build/mp4-muxer.js"><\/script>');
        }
        if (typeof Mp4Muxer === 'undefined') {
            document.write('<script src="https://unpkg.com/mp4-muxer/build/mp4-muxer.js"><\/script>');
        }
        if (typeof Mp4Muxer === 'undefined') {
            document.write('<script src="vendor/mp4-muxer/mp4-muxer.js"><\/script>');
        }
    </script>
    <script src="./vendor/ffmpeg/ffmpeg.js"></script>
    <script src="./vendor/ffmpeg/util.js"></script>'''

if old_head in content:
    content = content.replace(old_head, new_head)
    print("Updated head section with multi-CDN fallback")
else:
    print("Old head pattern not found, trying alternative...")
    # Try with slight variations
    content = content.replace(
        '<script src="https://unpkg.com/vue@3/dist/vue.global.js"></script>',
        '<script src="https://cdn.bootcdn.net/ajax/libs/vue/3.3.4/vue.global.js"></script>\n    <script>\n        if (typeof Vue === \'undefined\') {\n            document.write(\'<script src="https://cdn.jsdelivr.net/npm/vue@3/dist/vue.global.js"><\\/script>\');\n        }\n        if (typeof Vue === \'undefined\') {\n            document.write(\'<script src="https://unpkg.com/vue@3/dist/vue.global.js"><\\/script>\');\n        }\n        if (typeof Vue === \'undefined\') {\n            document.write(\'<script src="vendor/vue/vue.js"><\\/script>\');\n        }\n    </script>'
    )

# 2. 替换 picsum 背景为梯度
old_body = '''        /* 随机背景与毛玻璃特效 */
        body {
            background-color: #f1f5f9;
            /* Fallback color */
            background-image: url('https://picsum.photos/1920/1080');
            background-size: cover;
            background-position: center;
            background-attachment: fixed;
        }'''

new_body = '''        /* 随机背景与毛玻璃特效 */
        body {
            background-color: #f1f5f9;
            /* Fallback color */
            background-image: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%);
            background-size: cover;
            background-position: center;
            background-attachment: fixed;
        }'''

if old_body in content:
    content = content.replace(old_body, new_body)
    print("Replaced picsum background with gradient")
else:
    # Simple replacement
    content = content.replace("background-image: url('https://picsum.photos/1920/1080');", "background-image: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%);")
    print("Replaced picsum URL directly")

# 3. 在最后添加最终兜底检查脚本
mount_end = '''        }).mount('#app');
    </script>
</body>'''

final_safeguard = '''        }).mount('#app');
    </script>
    <!-- Final safeguard: show error message if resources fail to load -->
    <script>
        setTimeout(() => {
            const app = document.getElementById('app');
            if (app && app.innerHTML.includes('{{') && !app.querySelector('.error-message')) {
                const errorMsg = document.createElement('div');
                errorMsg.className = 'error-message';
                errorMsg.style.cssText = 'padding: 50px; text-align: center; font-family: sans-serif; color: #e11d48;';
                errorMsg.innerHTML = '<h2>前端框架加载失败</h2><p>所有资源均不可用，请检查网络连接或代理设置。</p>';
                app.innerHTML = '';
                app.appendChild(errorMsg);
            }
        }, 3000);
    </script>
</body>'''

if mount_end in content:
    content = content.replace(mount_end, final_safeguard)
    print("Added final safeguard script")
else:
    print("Mount end pattern not found")

# 写入文件
with open('G:/AI/Unitale/repo/index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("\nAll updates completed successfully!")