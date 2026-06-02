import type { Module, AppContext } from '../types';
import { Router } from 'express';
import { migrations } from './migrations';
import { buildResumeRouter } from './router';
import { ResumeRepo } from './repo';

// Initial master resume — seeded once on first boot. The user edits via the
// /resume UI; each save creates a new version. Replace via the UI, not here.
const SEED_RESUME = JSON.stringify(
  {
    contact: {
      name: 'Spencer Fevreau',
      email: '',
      phone: '',
      location: 'Durham, ON',
      links: [{ label: 'cranberrylabs.net', url: 'https://cranberrylabs.net' }],
    },
    summary: '',
    experience: [
      {
        id: 'exp-1',
        company: 'General Motors',
        title: 'Client Services Support Intern',
        start: '2026-01',
        end: 'present',
        location: 'Oshawa, ON',
        bullets: [
          {
            id: 'b-1-1',
            text: 'Worked on call centre 2026 network refresh project alongside infrastructure specialists. Installed hardware, cabling, and managed device templates with Opengear OOBA, Cisco ASR 1000 series routers, 9000 series Catalyst switches, and older 6500 chassis.',
            tags: ['networking', 'cisco', 'infrastructure'],
            metrics: [],
          },
          {
            id: 'b-1-2',
            text: 'Contributed to network upgrade projects including test track, firewall appliance and application server reconfiguration, switch imaging, and troubleshooting.',
            tags: ['networking', 'firewall', 'troubleshooting'],
            metrics: [],
          },
          {
            id: 'b-1-3',
            text: 'Self-guided infrastructure provisioning: racking and cabling Dell R660 servers, 3D printing, documentation.',
            tags: ['infrastructure', 'server', 'documentation'],
            metrics: [],
          },
        ],
      },
      {
        id: 'exp-2',
        company: 'Bell Canada (Bell Technical Solutions)',
        title: 'Fibre Optic Technician',
        start: '2023-04',
        end: 'present',
        location: 'Durham, ON',
        bullets: [
          {
            id: 'b-2-1',
            text: 'Install, configure, and repair FTTH fibre optic networks — internet, IPTV, and home phone — including central splitting points and copper/fibre splicing.',
            tags: ['fibre optic', 'FTTH', 'networking'],
            metrics: [],
          },
          {
            id: 'b-2-2',
            text: 'Cable and configure residential networks to customer specifications across diverse field environments.',
            tags: ['customer service', 'networking'],
            metrics: [],
          },
        ],
      },
    ],
    skills: [
      { category: 'Networking', items: ['Copper & fibre splicing', 'VPN deployment'] },
      {
        category: 'Infrastructure',
        items: [
          'VMware ESXi / Proxmox',
          'Windows / Linux server deployment',
          'Web stack deployment',
          'Cloud orchestration',
        ],
      },
      {
        category: 'General IT',
        items: ['Hardware & software troubleshooting', 'Database design & deployment'],
      },
    ],
    education: [
      {
        id: 'edu-1',
        institution: 'Durham College',
        degree: 'Computer Systems Technology',
        credential: 'Advanced Diploma (6 semesters)',
        start: '2024-01',
        end: '2027-04',
        location: 'Oshawa, ON',
        notes:
          'IT systems and business solutions for industry. Key courses: hardware, data communications, databases, web dev, virtualization, Linux, PowerShell, cyber security.',
      },
    ],
    certifications: [
      {
        id: 'cert-1',
        name: 'Bell FTTH Technician Training',
        description:
          'FTTH, pair splicing, general telecommunications, ethernet splicing, working at heights',
      },
      {
        id: 'cert-2',
        name: 'DELF Level A2 Certification',
        description: 'Basic French conversational fluency',
      },
    ],
    projects: [],
  },
  null,
  2,
);

const SEED_COVER_LETTER = `As a telecommunications technician, I've spent three years diagnosing and managing network connectivity for clients and finding solutions. To deepen my understanding of the infrastructure I work with daily, I'm completing a computer systems technologist diploma with hands-on experience with Active Directory, cloud operations and enterprise network configuration. This combination of field experience and formal technical training has prepared me for this IT Service Analyst role at [Company].

I am drawn to the prideful and result-oriented approach demanded by a fast-moving ever-growing manufacturing environment. The importance of up-time and keeping business flowing is essential to any business, but manufacturing requires an especially fast turnaround, and my improvisational skills and troubleshooting will lend itself well to your workplace.

Building on my telecommunications experience to transition into IT infrastructure, I am eager to put the skills I've developed throughout my career and program into practice at [Company]. I look forward to discussing this opportunity with you further.

Kind regards,
Spencer`;

export const resumeModule: Module = {
  name: 'resume',
  version: '0.1.0',
  router: Router(),
  migrations,
  workers: [],
  scheduledTasks: [],
  init: async (ctx: AppContext) => {
    resumeModule.router = buildResumeRouter(ctx);

    const repo = new ResumeRepo(ctx.db);

    // Seed initial resume if the table is empty. Use '' as the seed userId —
    // the users module backfill (which runs after all module inits) will update
    // it to the configured initial_admin username. The check is unscoped so it
    // doesn't re-seed on subsequent boots after the backfill runs.
    const seedUserId = '';
    const anyActive = ctx.db
      .prepare('SELECT id FROM master_resume WHERE is_active = 1 LIMIT 1')
      .get();
    if (!anyActive) {
      const resume = repo.create(SEED_RESUME, 'initial import', seedUserId);
      repo.activate(resume.id, seedUserId);
      ctx.logger.info('resume: seeded initial master resume');
    }

    // Seed initial writing sample if none exist.
    const { c } = ctx.db
      .prepare('SELECT COUNT(*) AS c FROM writing_samples')
      .get() as { c: number };
    if (c === 0) {
      repo.createWritingSample(
        'Cover letter — IT support / sysadmin',
        'cover_letter',
        SEED_COVER_LETTER,
        seedUserId,
      );
      ctx.logger.info('resume: seeded initial writing sample');
    }

    ctx.logger.debug('resume module initialized');
  },
};
