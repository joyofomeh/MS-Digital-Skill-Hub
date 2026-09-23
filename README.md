# MS Digital Skill Hub

MS Digital Skill Hub is a static website for a tech training and talent platform. It helps learners apply to programmes like Product Management and Virtual Assistance, and helps recruiters connect with vetted talent.

## Project Structure

The site is split into organized assets and pages:

- `index.html` - Main homepage
- `about.html` - About us page
- `css/styles.css` - Global styles including light and dark themes
- `assets/images/` - Images used across the site
  - `assets/images/logo.jpg.png` - Brand logo
  - `assets/images/bg.png` - Hero background image
  - `assets/images/headshot.jpg` - Founder photo
  - `assets/images/testimonials/` - Testimonial images
- `container/` - Design reference materials and instructions

## Features

- Responsive landing page with hero, programmes, testimonials, and contact sections
- About page with mission, vision, values and founder information
- Light and dark theme toggle with saved preference
- Programme application modals linking to external Google Forms
- Smooth scroll navigation and mobile friendly layout

## Local Development

Since this is a static site, no build step is required. To view it locally:

1. Clone or download this repository
2. Open `index.html` in your web browser

Alternatively, serve it with a simple local server:

```bash
python3 -m http.server 8000
```

Then visit http://localhost:8000 in your browser.

## Contact

For more information, visit [MS Digital Skill Hub](https://msdigitalskillhub.com) or email info@msdigitalskillhub.com.
