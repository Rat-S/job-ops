const fs = require('fs');
const rr = JSON.parse(fs.readFileSync('../data/master-resume.json', 'utf8'));

if (rr.sections) {
  const jsonResume = {
    basics: rr.basics,
    work: (rr.sections.experience?.items || []).map(item => ({
      name: item.company,
      position: item.position,
      url: item.url,
      startDate: item.date?.split(' - ')[0] || '',
      endDate: item.date?.split(' - ')[1] || '',
      summary: item.summary,
      highlights: [item.summary] // fallback
    })),
    education: (rr.sections.education?.items || []).map(item => ({
      institution: item.institution,
      area: item.area,
      studyType: item.degree,
      startDate: item.date?.split(' - ')[0] || '',
      endDate: item.date?.split(' - ')[1] || '',
      score: item.score
    })),
    skills: (rr.sections.skills?.items || []).map(item => ({
      name: item.name,
      level: item.level,
      keywords: item.keywords || []
    })),
    projects: (rr.sections.projects?.items || []).map(item => ({
      name: item.name,
      description: item.description,
      highlights: item.keywords || [],
      startDate: item.date?.split(' - ')[0] || '',
      endDate: item.date?.split(' - ')[1] || ''
    })),
    certificates: (rr.sections.certifications?.items || []).map(item => ({
      name: item.name,
      date: item.date,
      issuer: item.issuer,
      url: item.url
    }))
  };
  fs.writeFileSync('../data/master-resume.json', JSON.stringify(jsonResume, null, 2));
  console.log("Converted to standard JSON Resume!");
} else {
  console.log("Already in standard format or unknown format.");
}
