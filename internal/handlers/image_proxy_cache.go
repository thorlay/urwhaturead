package handlers

import (
	"container/list"
	"sync"
	"time"
)

type proxyImage struct {
	body        []byte
	contentType string
}

type imageProxyCacheEntry struct {
	key       string
	image     proxyImage
	expiresAt time.Time
}

type imageProxyCache struct {
	mu            sync.Mutex
	entries       map[string]*list.Element
	lru           *list.List
	maxBytes      int
	maxEntries    int
	maxEntryBytes int
	ttl           time.Duration
	usedBytes     int
}

func newImageProxyCache(maxBytes, maxEntries, maxEntryBytes int, ttl time.Duration) *imageProxyCache {
	return &imageProxyCache{
		entries:       make(map[string]*list.Element),
		lru:           list.New(),
		maxBytes:      maxBytes,
		maxEntries:    maxEntries,
		maxEntryBytes: maxEntryBytes,
		ttl:           ttl,
	}
}

func (c *imageProxyCache) get(key string, now time.Time) (proxyImage, bool) {
	if c == nil {
		return proxyImage{}, false
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	element, ok := c.entries[key]
	if !ok {
		return proxyImage{}, false
	}
	entry := element.Value.(*imageProxyCacheEntry)
	if !now.Before(entry.expiresAt) {
		c.remove(element)
		return proxyImage{}, false
	}
	c.lru.MoveToFront(element)
	return entry.image, true
}

func (c *imageProxyCache) add(key string, image proxyImage, now time.Time) bool {
	if c == nil || key == "" || len(image.body) == 0 || c.ttl <= 0 || c.maxBytes <= 0 || c.maxEntries <= 0 {
		return false
	}
	if len(image.body) > c.maxBytes || c.maxEntryBytes > 0 && len(image.body) > c.maxEntryBytes {
		return false
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if existing, ok := c.entries[key]; ok {
		c.remove(existing)
	}
	entry := &imageProxyCacheEntry{
		key:       key,
		image:     image,
		expiresAt: now.Add(c.ttl),
	}
	element := c.lru.PushFront(entry)
	c.entries[key] = element
	c.usedBytes += len(image.body)

	for c.usedBytes > c.maxBytes || c.lru.Len() > c.maxEntries {
		c.remove(c.lru.Back())
	}
	return true
}

func (c *imageProxyCache) remove(element *list.Element) {
	if element == nil {
		return
	}
	entry := element.Value.(*imageProxyCacheEntry)
	delete(c.entries, entry.key)
	c.usedBytes -= len(entry.image.body)
	c.lru.Remove(element)
}
