import urllib.request, os

os.makedirs('G:/AI/Unitale/repo/vendor/vue', exist_ok=True)
os.makedirs('G:/AI/Unitale/repo/vendor/mp4-muxer', exist_ok=True)
os.makedirs('G:/AI/Unitale/repo/vendor/tailwind', exist_ok=True)

# Try multiple CDNs for Vue
urls = [
    'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.global.js',
    'https://unpkg.com/vue@3/dist/vue.global.js'
]
for url in urls:
    try:
        urllib.request.urlretrieve(url, 'G:/AI/Unitale/repo/vendor/vue/vue.js')
        print(f'Veue downloaded from {url}')
        break
    except Exception as e:
        print(f'{url} failed: {e}')

# mp4-muxer
urls2 = [
    'https://cdn.jsdelivr.net/npm/mp4-muxer@1.1.2/build/mp4-muxer.js',
    'https://unpkg.com/mp4-muxer/build/mp4-muxer.js'
]
for url in urls2:
    try:
        urllib.request.urlretrieve(url, 'G:/AI/Unitale/repo/vendor/mp4-muxer/mp4-muxer.js')
        print(f'mp4-muxer downloaded from {url}')
        break
    except Exception as e:
        print(f'{url} failed: {e}')

# Tailwind
try:
    urllib.request.urlretrieve('https://cdn.tailwindcss.com', 'G:/AI/Unitale/repo/vendor/tailwind/tailwind.css')
    print('Tailwind downloaded')
except Exception as e:
    print(f'Tailwind download failed: {e}')