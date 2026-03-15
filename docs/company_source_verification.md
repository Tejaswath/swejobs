# Company Source Verification

Generated at: `2026-03-13T19:25:16.215884+00:00`

## Volvo Cars

- canonical: `volvo cars`
- current_status: `planned`
- recommended_status: `planned`

| Provider | HTTP | Endpoint | Location filtering | Target rows | Notes |
| --- | --- | --- | --- | --- | --- |
| jobs2web | None | https://jobs.volvocars.com/search/?q=&locationsearch=Sweden | True | 0 | environment_dns_failure, curl: (6) Could not resolve host: jobs.volvocars.com |
| workday | None | None | False | 0 | environment_dns_failure, discovery_environment_dns_failure |
| smartrecruiters | None | None | False | 0 | environment_dns_failure, curl: (6) Could not resolve host: api.smartrecruiters.com |
| greenhouse | None | None | True | 0 | environment_dns_failure, curl: (6) Could not resolve host: boards-api.greenhouse.io |
| lever | None | None | True | 0 | environment_dns_failure, curl: (6) Could not resolve host: api.lever.co |
| teamtailor | None | https://jobs.volvocars.com/jobs | True | 0 | environment_dns_failure, curl: (6) Could not resolve host: jobs.volvocars.com |
| html_fallback | None | https://jobs.volvocars.com/ | False | 0 | environment_dns_failure, curl: (6) Could not resolve host: jobs.volvocars.com |
