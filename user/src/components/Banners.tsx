import { useState, useEffect } from 'react'
import { Swiper, SwiperSlide } from 'swiper/react'
import { Autoplay, Pagination, Navigation } from 'swiper/modules'
import { useAppSettings } from '../lib/app-settings'
import { useNavigate } from 'react-router-dom'

export default function Banners({ layout = 'carousel' }: { layout?: 'carousel' | 'rail' }) {
  const { advertisements, isLoading } = useAppSettings()
  const navigate = useNavigate()
  
  // Detect if device is mobile
  const [isMobile, setIsMobile] = useState(false)
  
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768) // md breakpoint
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])
  
  // Filter active advertisements (status is handled by backend, but check image exists)
  const activeAds = advertisements.filter(ad => ad.image)
  
  // Filter by device type:
  // - Mobile: show ads where deviceType is 'MOBILE' or 'BOTH'
  // - Desktop: show ads where deviceType is 'DESKTOP' or 'BOTH'
  const filteredAds = activeAds.filter(ad => {
    const deviceType = ad.deviceType || 'BOTH'
    if (isMobile) {
      // Mobile device: show MOBILE or BOTH
      return deviceType === 'MOBILE' || deviceType === 'BOTH'
    } else {
      // Desktop: show DESKTOP or BOTH
      return deviceType === 'DESKTOP' || deviceType === 'BOTH'
    }
  })
  
  // Only the admin's advertisements for this device: no stock promo banners stand in for them.
  const finalMobileImages = filteredAds
  const finalDesktopImages = filteredAds

  const handleBannerClick = (ad: any) => {
    if (ad.url) {
      if (ad.url.startsWith('http://') || ad.url.startsWith('https://')) {
        window.open(ad.url, '_blank', 'noopener,noreferrer')
      } else {
        navigate(ad.url)
      }
    }
  }

  // Show loading state if data is being fetched
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="md:hidden">
          <div className="h-48 bg-[color:var(--surface-2)] rounded-[5px] animate-pulse"></div>
        </div>
        <div className={`hidden md:grid ${layout === 'rail' ? 'grid-cols-1 gap-2' : 'grid-cols-2 gap-4'}`}>
          {Array.from({ length: 2 }, (_, index) => <div key={index} className={`${layout === 'rail' && index === 1 ? 'h-40' : 'h-48'} bg-[color:var(--surface-2)] rounded-[5px] animate-pulse`} />)}
        </div>
      </div>
    )
  }

  if (filteredAds.length === 0) return null

  return (
    <>
      {/* Mobile Slider */}
      <div className="md:hidden">
        <Swiper
          modules={[Autoplay, Pagination, Navigation]}
          spaceBetween={0}
          slidesPerView={1}
          autoplay={{
            delay: 4000,
            disableOnInteraction: false,
          }}
          pagination={{
            clickable: true,
            dynamicBullets: true,
          }}
          navigation={false}
          loop={finalMobileImages.length > 1}
          className="rounded-[5px] overflow-hidden shadow-soft"
          style={{ height: '200px' }}
        >
          {finalMobileImages.map((item, index) => {
            const isAd = typeof item === 'object' && item.image
            const imageSrc: string = isAd ? (item.image || '') : (typeof item === 'string' ? item : '')
            const ad = isAd ? item : null
            const hasUrl = Boolean(ad?.url)

            return (
              <SwiperSlide key={ad?.id || index}>
                <div
                  className={`relative w-full h-full overflow-hidden rounded-[5px] ${hasUrl ? 'cursor-pointer' : 'cursor-default'}`}
                  onClick={() => ad && handleBannerClick(ad)}
                  onKeyDown={(e) => {
                    if (!hasUrl || !ad) return
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleBannerClick(ad)
                    }
                  }}
                  role={hasUrl ? 'link' : undefined}
                  tabIndex={hasUrl ? 0 : undefined}
                  style={{ height: '200px' }}
                >
                  <img
                    src={imageSrc}
                    alt={ad?.title || `Mobile Banner ${index + 1}`}
                    className="w-full h-full object-cover rounded-[5px]"
                    style={{ height: '200px' }}
                  />
                </div>
              </SwiperSlide>
            )
          })}
        </Swiper>
      </div>
      
      {layout === 'rail' ? <div className="hidden md:grid nova-banner-rail">
        {finalDesktopImages.slice(0, 2).map((item, index) => {
          const isAd = typeof item === 'object' && item.image
          const imageSrc: string = isAd ? (item.image || '') : (typeof item === 'string' ? item : '')
          const ad = isAd ? item : null
          const hasUrl = Boolean(ad?.url)

          return <div key={ad?.id || index}
            className={`nova-banner-rail-card ${index === 0 ? 'primary' : 'secondary'} ${hasUrl ? 'cursor-pointer' : 'cursor-default'}`}
            onClick={() => ad && handleBannerClick(ad)}
            onKeyDown={e => {
              if (!hasUrl || !ad) return
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                handleBannerClick(ad)
              }
            }}
            role={hasUrl ? 'link' : undefined}
            tabIndex={hasUrl ? 0 : undefined}>
            <img src={imageSrc} alt={ad?.title || `Desktop Banner ${index + 1}`} loading="lazy" />
          </div>
        })}
      </div> : <div className="hidden md:block mb-4">
        <Swiper
          modules={[Autoplay, Pagination, Navigation]}
          spaceBetween={16}
          slidesPerView={2}
          autoplay={{
            delay: 4000,
            disableOnInteraction: false,
          }}
          pagination={{
            clickable: true,
            dynamicBullets: true,
          }}
          navigation={false}
          loop={finalDesktopImages.length > 1}
          className="nova-banner-carousel rounded-[5px] overflow-hidden shadow-soft"
        >
          {finalDesktopImages.map((item, index) => {
            const isAd = typeof item === 'object' && item.image
            const imageSrc: string = isAd ? (item.image || '') : (typeof item === 'string' ? item : '')
            const ad = isAd ? item : null
            const hasUrl = Boolean(ad?.url)

            return (
              <SwiperSlide key={ad?.id || index}>
                <div
                  className={`relative overflow-hidden rounded-[5px] shadow-soft ${hasUrl ? 'cursor-pointer' : 'cursor-default'}`}
                  onClick={() => ad && handleBannerClick(ad)}
                  onKeyDown={(e) => {
                    if (!hasUrl || !ad) return
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleBannerClick(ad)
                    }
                  }}
                  role={hasUrl ? 'link' : undefined}
                  tabIndex={hasUrl ? 0 : undefined}
                  style={{ height: '200px' }}
                >
                  <img
                    src={imageSrc}
                    alt={ad?.title || `Desktop Banner ${index + 1}`}
                    className="w-full h-full object-cover rounded-[5px]"
                    style={{ height: '200px' }}
                  />
                </div>
              </SwiperSlide>
            )
          })}
        </Swiper>
      </div>}
    </>
  )
}


