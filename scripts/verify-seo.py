#!/usr/bin/env python3
"""Verify deployed HTML and share metadata without running JavaScript."""
import json
import struct
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from html.parser import HTMLParser

base = (sys.argv[1] if len(sys.argv) > 1 else "https://undertow.subcult.tv").rstrip("/")
canonical = "https://undertow.subcult.tv/"

class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.meta = {}
        self.links = []
        self.structured = []
        self.in_json = False
        self.h1 = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "meta":
            key = attrs.get("property", attrs.get("name"))
            assert key not in self.meta, f"Duplicate meta: {key}"
            self.meta[key] = attrs.get("content")
        if tag == "link" and attrs.get("rel") == "canonical":
            self.links.append(attrs.get("href"))
        if tag == "script":
            self.in_json = attrs.get("type") == "application/ld+json"
        if tag == "h1":
            self.h1 = True

    def handle_endtag(self, tag):
        if tag == "script":
            self.in_json = False

    def handle_data(self, data):
        if self.in_json:
            self.structured.append(json.loads(data))

def fetch(path, agent="Googlebot"):
    request = urllib.request.Request(base + path, headers={"User-Agent": agent})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.headers, error.read()

for agent in ["Googlebot", "Twitterbot/1.0", "facebookexternalhit/1.1", "LinkedInBot/1.0"]:
    status, headers, body = fetch("/", agent)
    assert status == 200 and "text/html" in headers.get("Content-Type", "")
    assert "noindex" not in headers.get("X-Robots-Tag", "").lower()
    page = Page()
    page.feed(body.decode())
    assert page.links == [canonical]
    assert page.h1 and b"Free Music Visualizer Video Editor</title>" in body
    assert page.meta["og:url"] == canonical
    assert page.meta["og:image"] == canonical + "og-glitch.png"
    assert page.meta["twitter:image"] == page.meta["og:image"]
    assert page.meta["twitter:card"] == "summary_large_image"
    assert "noindex" not in page.meta["robots"]
    for key in ["description", "og:title", "og:description", "og:image:alt", "twitter:title", "twitter:description", "twitter:image:alt"]:
        assert page.meta[key], key
    assert len(page.structured) == 1 and page.structured[0]["@type"] == "WebApplication"
    print(f"PASS {agent}: indexable HTML, canonical, structured data and link card tags")

status, headers, image = fetch("/og-glitch.png", "Twitterbot/1.0")
assert status == 200 and "image/png" in headers.get("Content-Type", "")
assert image[:8] == b"\x89PNG\r\n\x1a\n" and struct.unpack(">II", image[16:24]) == (1200, 630)
assert len(image) < 5_000_000
print(f"PASS share image: 1200x630 PNG, {len(image)} bytes")
status, headers, body = fetch("/robots.txt")
assert status == 200 and "text/plain" in headers.get("Content-Type", "")
assert b"Disallow: /\n" not in body and ("Sitemap: " + canonical + "sitemap.xml").encode() in body
status, _, body = fetch("/sitemap.xml")
assert status == 200
assert [node.text for node in ET.fromstring(body).iter("{http://www.sitemaps.org/schemas/sitemap/0.9}loc")] == [canonical]
for path in ["/styleguide.html", "/render.html", "/healthz", "/v1/openapi.json", "/?account=reset&token=seo-test"]:
    _, headers, _ = fetch(path)
    assert "noindex" in headers.get("X-Robots-Tag", ""), path
assert fetch("/seo-missing-page-test")[0] == 404
print("PASS robots, sitemap, private-page exclusions and real 404")
