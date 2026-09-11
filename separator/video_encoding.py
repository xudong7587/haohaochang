"""Source-size / source-rate compatibility encoding; hardware is independent of AI device."""
from functools import lru_cache
import os
import subprocess


@lru_cache(maxsize=4)
def available_encoders(ffmpeg):
    try:
        result = subprocess.run([ffmpeg, '-hide_banner', '-encoders'], capture_output=True,
            text=True, encoding='utf-8', errors='replace', timeout=10,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0), check=True)
        return {line.split()[1] for line in result.stdout.splitlines() if len(line.split()) > 1}
    except (OSError, subprocess.SubprocessError):
        return set()


def encoder_plans(ffmpeg, height, fps, video_only=True):
    bitrate = (40 if fps > 40 else 28) if height > 1440 else (20 if fps > 40 else 14) if height > 1080 else (12 if fps > 40 else 8)
    limit = ['-maxrate', f'{bitrate * 1.5:g}M', '-bufsize', f'{bitrate * 3}M']
    preference = os.getenv('KTV_VIDEO_ENCODER', 'auto').lower()
    available = available_encoders(ffmpeg) if preference != 'cpu' else set()
    plans = []
    if preference in ('auto', 'nvenc') and ('h264_nvenc' in available or preference == 'nvenc'):
        settings = ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '22', '-b:v', f'{bitrate}M'] + limit
        # GPU decode can fail for an unsupported source codec. Keep NVENC for
        # a second attempt using CPU decode before falling back to CPU encode.
        plans.extend([(settings, 'NVIDIA NVENC + CUDA decode', True), (settings, 'NVIDIA NVENC', False)])
    if preference in ('auto', 'qsv') and ('h264_qsv' in available or preference == 'qsv'):
        plans.append((['-c:v', 'h264_qsv', '-preset', 'veryfast', '-look_ahead', '0', '-b:v', f'{bitrate}M'] + limit, 'Intel Quick Sync', False))
    if preference in ('auto', 'amf') and ('h264_amf' in available or preference == 'amf'):
        plans.append((['-c:v', 'h264_amf', '-usage', 'transcoding', '-quality', 'speed', '-rc', 'vbr_peak', '-b:v', f'{bitrate}M'] + limit, 'AMD AMF', False))
    plans.append((['-c:v', 'libx264', '-preset', 'veryfast' if video_only else 'fast',
        '-crf', '22' if video_only else '20'] + limit, 'CPU libx264', False))
    return plans


def video_filter(hdr_transfer=''):
    # SDR conversion is explicit in the compatibility action. Ordinary imports
    # still remux the source, preserving its 4K60, HDR and original codec.
    scale = "scale=w='trunc(iw/2)*2':h=-2"
    if hdr_transfer in ('smpte2084', 'arib-std-b67'):
        return (f'zscale=pin=bt2020:tin={hdr_transfer}:min=bt2020nc:t=linear:npl=100,'
            'format=gbrpf32le,tonemap=tonemap=hable:desat=0,'
            'zscale=p=bt709:t=bt709:m=bt709:r=tv,format=yuv420p,' + scale)
    return scale
