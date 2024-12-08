export const getMetas = (title, description, shareImgUrl, shareImgAlt) => [
    {name: 'description', content: description},
    {name: 'og:title', property: 'og:title', content: title},
    {name: 'og:description', property:'og:description', content: description},
    {name: 'og:site_name', property: 'og:site_name', content: title},
    {name: 'og:image', property: 'og:image', content: shareImgUrl},
    {name: 'og:image:secure_url', property: 'og:image:secure_url', content: shareImgUrl},
    {name: 'og:image:alt', property: 'og:image:alt', content: shareImgAlt},
    {name: 'og:type', property: 'og:type', content: 'website'},
    {name: 'twitter:title', content: title},
    {name: 'twitter:card', content: 'summary_large_image'},
    {name: 'twitter:image', content: shareImgUrl},
]
