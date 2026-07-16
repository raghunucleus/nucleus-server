// Indian school education boards (Class X, Class XII) and polytechnic
// diploma-awarding bodies.
//
// Sources: COBSE member list (https://www.cobse.org.in/members/) for official
// board names, cross-checked against each board's own site and Wikipedia's
// state-board lists; AICTE and state technical-education board sites for the
// diploma bodies. Retrieved: 2026-07-17.
//
// Consumed only by 1792900000000-CreateEducationBoards.ts. It is a .ts module
// rather than .json deliberately: tsconfig.json sets no `resolveJsonModule`, and
// nest build type-checks src/migrations/**, so a JSON import would pass
// migration:run (ts-node runs transpileOnly) and then fail the build with TS2732.
//
// ---------------------------------------------------------------------------
// is_active is OPT-IN here, and that inverts the column default (`true`).
//
// The catalogue ships complete but dormant: only the boards Raghu actually
// admits through are selectable on day one, and an admin activates any other row
// the moment a real applicant turns up with it. A dropdown of 35 mostly
// irrelevant boards is worse than one with 3 — the dormant rows are
// documentation, the active ones are the working set.
//
// Active on day one (7 of 98): BSEAP/CBSE/CISCE at X, BIEAP/CBSE/CISCE at XII,
// SBTET_AP for diploma. The migration asserts these counts, so changing an
// is_active flag here means updating expectedActive in
// 1792900000000-CreateEducationBoards.ts too — the seed and the canary are
// meant to disagree loudly rather than drift quietly.
//
// The DB column default stays `true` on purpose: a board an *admin* creates
// through the UI should obviously be usable immediately. Only this bulk seed is
// dormant. Do not "fix" the mismatch.
// ---------------------------------------------------------------------------
//
// Codes use underscores (BSE_OD, SBTET_AP) rather than spaces or ampersands to
// satisfy the /^[A-Z0-9._-]+$/ code regex every lookup in this codebase shares.
// The unabbreviated name carries the official spelling. Abbreviation collisions
// across states are severe — SCTE is both Assam and Nagaland, SBTE is Bihar,
// Jharkhand, Kerala and Sikkim, SBTET is Andhra, Telangana and Tamil Nadu — so
// state suffixes are mandatory, not stylistic. Arunachal's natural "APSCTE"
// would read as Andhra, hence SCTE_AR.
//
// DELIBERATELY NOT SEEDED — sources contradict each other or no government site
// confirms them. Admins can add any of these through the UI if an applicant
// appears:
//   - Sikkim school board: the state's own Education Department publishes a
//     "CBSE EXAM 2025 REPORT" for its schools and several sources say it has no
//     autonomous board, yet COBSE lists one. Unresolved.
//   - Puducherry school board: Puducherry's own exam cell says SSLC/HSC
//     notifications come from the Department of Government Examinations,
//     Chennai (i.e. Tamil Nadu's DGE). Absent from COBSE.
//   - Arunachal Pradesh school board: no statutory board found; the Directorate
//     of School Education runs the exams and most schools are CBSE. Absent from
//     COBSE, which is a meaningful negative signal.
//   - Mizoram / Manipur / Tripura / Puducherry diploma bodies: no state council
//     confirmable; polytechnics appear to affiliate to universities instead.
//   - Open-schooling, madrasa and Sanskrit boards (~25 in COBSE) beyond NIOS.
//
// UTs with no board of their own — mapped to an existing code, not fabricated:
// Andaman & Nicobar, Chandigarh, Lakshadweep and Dadra & Nagar Haveli and Daman
// & Diu all use CBSE for school; Ladakh uses JKBOSE (whose statute covers both
// UTs post-2019). For diplomas: Chandigarh → PSBTE_IT (Punjab's 1992 Act names
// it explicitly), Ladakh → JKBOTE, Andaman & Nicobar → MSBTE, DNH&DD → GTU.

export interface BoardSeed {
  code: string;
  name: string;
  description: string;
  // Absent → seeded inactive. See the note above.
  is_active?: boolean;
}

export interface EducationBoardsSeed {
  x: BoardSeed[];
  xii: BoardSeed[];
  diploma: BoardSeed[];
}

// Class X — Secondary / SSC / SSLC / Matriculation / HSLC.
const X: BoardSeed[] = [
  {
    code: 'CBSE',
    name: 'Central Board of Secondary Education',
    description:
      'National board; conducts the All India Secondary School Examination (AISSE) at Class X.',
    is_active: true,
  },
  {
    code: 'CISCE',
    name: 'Council for the Indian School Certificate Examinations',
    description:
      'National private board; conducts the Indian Certificate of Secondary Education (ICSE) examination at Class X.',
    is_active: true,
  },
  // Dormant despite being a national board — open schooling is a rare route
  // into engineering admissions here. Same in the XII list. Activate it if an
  // NIOS applicant turns up.
  {
    code: 'NIOS',
    name: 'National Institute of Open Schooling',
    description:
      'National open-schooling board; issues the Secondary (Class X) certificate through open/distance learning.',
  },
  {
    code: 'BSEAP',
    name: 'Board of Secondary Education, Andhra Pradesh',
    description:
      'Andhra Pradesh; conducts the SSC (Class X) public examination.',
    is_active: true,
  },
  {
    code: 'ASSEB',
    name: 'Assam State School Education Board',
    description:
      'Assam; conducts the HSLC (Class X) examination. Formed in September 2024 by merging SEBA and AHSEC; SEBA became its Division-I.',
  },
  {
    code: 'SEBA',
    name: 'Board of Secondary Education, Assam',
    description:
      'Assam; conducted the HSLC (Class X) examination until it was dissolved into ASSEB in September 2024. Kept for students holding pre-2024 certificates.',
  },
  {
    code: 'BSEB',
    name: 'Bihar School Examination Board',
    description:
      'Bihar; conducts the Matriculation (Class X) annual examination.',
  },
  {
    code: 'CGBSE',
    name: 'Chhattisgarh Board of Secondary Education',
    description:
      'Chhattisgarh; conducts the Class X (High School Certificate) examination.',
  },
  {
    code: 'DBSE',
    name: 'Delhi Board of School Education',
    description:
      'NCT of Delhi; conducts the Class X examination for the schools affiliated to it (Schools of Specialised Excellence, Delhi Model Virtual School). Most Delhi schools remain CBSE.',
  },
  {
    code: 'GBSHSE',
    name: 'Goa Board of Secondary and Higher Secondary Education',
    description: 'Goa; conducts the SSC (Class X) examination.',
  },
  {
    code: 'GSEB',
    name: 'Gujarat Secondary and Higher Secondary Education Board',
    description: 'Gujarat; conducts the SSC (Class X) examination.',
  },
  {
    code: 'BSEH',
    name: 'Board of School Education Haryana',
    description: 'Haryana; conducts the Secondary (Class X) examination.',
  },
  {
    code: 'HPBOSE',
    name: 'Himachal Pradesh Board of School Education',
    description:
      'Himachal Pradesh; conducts the Matriculation (Class X) examination.',
  },
  {
    code: 'JKBOSE',
    name: 'Jammu and Kashmir Board of School Education',
    description:
      'UTs of Jammu & Kashmir and Ladakh; conducts the Secondary School Examination (Class X).',
  },
  {
    code: 'JAC',
    name: 'Jharkhand Academic Council',
    description: 'Jharkhand; conducts the Matriculation (Class X) examination.',
  },
  {
    code: 'KSEAB',
    name: 'Karnataka School Examination and Assessment Board',
    description:
      'Karnataka; conducts the SSLC (Class X) examination. Renamed from KSEEB in 2022 on merger with the Department of Pre-University Education.',
  },
  {
    code: 'KBPE',
    name: 'Kerala Board of Public Examinations',
    description:
      'Kerala; conducts the SSLC (Class X) examination via Pareeksha Bhavan.',
  },
  {
    code: 'MPBSE',
    name: 'Board of Secondary Education, Madhya Pradesh',
    description:
      'Madhya Pradesh; conducts the High School Certificate (Class X) examination.',
  },
  {
    code: 'MSBSHSE',
    name: 'Maharashtra State Board of Secondary and Higher Secondary Education',
    description: 'Maharashtra; conducts the SSC (Class X) examination.',
  },
  {
    code: 'BSEM',
    name: 'Board of Secondary Education, Manipur',
    description: 'Manipur; conducts the HSLC (Class X) examination.',
  },
  {
    code: 'MBOSE',
    name: 'Meghalaya Board of School Education',
    description: 'Meghalaya; conducts the SSLC (Class X) examination.',
  },
  {
    code: 'MBSE',
    name: 'Mizoram Board of School Education',
    description: 'Mizoram; conducts the HSLC (Class X) examination.',
  },
  {
    code: 'NBSE',
    name: 'Nagaland Board of School Education',
    description: 'Nagaland; conducts the HSLC (Class X) examination.',
  },
  {
    code: 'BSE_OD',
    name: 'Board of Secondary Education, Odisha',
    description: 'Odisha; conducts the HSC (Class X) examination.',
  },
  {
    code: 'PSEB',
    name: 'Punjab School Education Board',
    description: 'Punjab; conducts the Matriculation (Class X) examination.',
  },
  {
    code: 'RBSE',
    name: 'Board of Secondary Education, Rajasthan',
    description: 'Rajasthan; conducts the Secondary (Class X) examination.',
  },
  {
    code: 'TN_DGE',
    name: 'Directorate of Government Examinations, Tamil Nadu',
    description:
      'Tamil Nadu; conducts the SSLC (Class X) public examination. Styled the State Board of School Examinations (Sec.).',
  },
  {
    code: 'BSE_TG',
    name: 'Board of Secondary Education, Telangana',
    description: 'Telangana; conducts the SSC (Class X) public examination.',
  },
  {
    code: 'TBSE',
    name: 'Tripura Board of Secondary Education',
    description: 'Tripura; conducts the Madhyamik (Class X) examination.',
  },
  {
    code: 'UPMSP',
    name: 'Board of High School and Intermediate Education, Uttar Pradesh',
    description:
      'Uttar Pradesh; conducts the High School (Class X) examination. Also known as Uttar Pradesh Madhyamik Shiksha Parishad.',
  },
  {
    code: 'UBSE',
    name: 'Board of School Education Uttarakhand',
    description: 'Uttarakhand; conducts the High School (Class X) examination.',
  },
  {
    code: 'WBBSE',
    name: 'West Bengal Board of Secondary Education',
    description:
      'West Bengal; conducts the Madhyamik Pariksha (Class X) examination.',
  },
  {
    code: 'CAIE',
    name: 'Cambridge Assessment International Education',
    description:
      'International board; issues IGCSE and O Level, which AIU treats as Class X equivalent.',
  },
  {
    code: 'IB',
    name: 'International Baccalaureate',
    description:
      'International board; issues the Middle Years Programme certificate, which AIU treats as Class X equivalent.',
  },
  {
    code: 'PEARSON_EDEXCEL',
    name: 'Pearson Edexcel',
    description:
      'International board; issues the Edexcel IGCSE, which AIU treats as Class X equivalent.',
  },
];

// Class XII — Senior Secondary / HSC / Intermediate / PUC.
//
// Note CISCE appears in both lists under the same code: it is one board that
// conducts ICSE at Class X and ISC at Class XII. Same for CBSE, NIOS and every
// state board that spans both classes. This is precisely why the two classes are
// separate tables rather than one table keyed by code.
const XII: BoardSeed[] = [
  {
    code: 'CBSE',
    name: 'Central Board of Secondary Education',
    description:
      'National board; conducts the All India Senior School Certificate Examination (AISSCE) at Class XII.',
    is_active: true,
  },
  {
    code: 'CISCE',
    name: 'Council for the Indian School Certificate Examinations',
    description:
      'National private board; conducts the Indian School Certificate (ISC) examination at Class XII.',
    is_active: true,
  },
  // Dormant — see the NIOS note in the X list above.
  {
    code: 'NIOS',
    name: 'National Institute of Open Schooling',
    description:
      'National open-schooling board; issues the Senior Secondary (Class XII) certificate through open/distance learning.',
  },
  {
    code: 'BIEAP',
    name: 'Board of Intermediate Education, Andhra Pradesh',
    description:
      'Andhra Pradesh; conducts the Intermediate (Class XI–XII) public examinations.',
    is_active: true,
  },
  {
    code: 'ASSEB',
    name: 'Assam State School Education Board',
    description:
      'Assam; conducts the Higher Secondary (Class XII) examination. Formed in September 2024 by merging SEBA and AHSEC; AHSEC became its Division-II.',
  },
  {
    code: 'AHSEC',
    name: 'Assam Higher Secondary Education Council',
    description:
      'Assam; conducted the Higher Secondary (Class XII) examination until it was dissolved into ASSEB in September 2024. Kept for students holding pre-2024 certificates.',
  },
  {
    code: 'BSEB',
    name: 'Bihar School Examination Board',
    description:
      'Bihar; conducts the Intermediate (Class XII) annual examination.',
  },
  {
    code: 'CGBSE',
    name: 'Chhattisgarh Board of Secondary Education',
    description:
      'Chhattisgarh; conducts the Class XII (Higher Secondary Certificate) examination.',
  },
  {
    code: 'DBSE',
    name: 'Delhi Board of School Education',
    description:
      'NCT of Delhi; conducts the Class XII examination for the schools affiliated to it. Most Delhi schools remain CBSE.',
  },
  {
    code: 'GBSHSE',
    name: 'Goa Board of Secondary and Higher Secondary Education',
    description: 'Goa; conducts the HSSC (Class XII) examination.',
  },
  {
    code: 'GSEB',
    name: 'Gujarat Secondary and Higher Secondary Education Board',
    description: 'Gujarat; conducts the HSC (Class XII) examination.',
  },
  {
    code: 'BSEH',
    name: 'Board of School Education Haryana',
    description:
      'Haryana; conducts the Senior Secondary (Class XII) examination.',
  },
  {
    code: 'HPBOSE',
    name: 'Himachal Pradesh Board of School Education',
    description:
      'Himachal Pradesh; conducts the Senior Secondary (Class XII) examination.',
  },
  {
    code: 'JKBOSE',
    name: 'Jammu and Kashmir Board of School Education',
    description:
      'UTs of Jammu & Kashmir and Ladakh; conducts the Higher Secondary Part-II (Class XII) examination.',
  },
  {
    code: 'JAC',
    name: 'Jharkhand Academic Council',
    description:
      'Jharkhand; conducts the Intermediate (Class XII) examination.',
  },
  {
    code: 'KSEAB',
    name: 'Karnataka School Examination and Assessment Board',
    description:
      'Karnataka; conducts the 2nd PUC (Class XII) examination. Absorbed the Department of Pre-University Education in 2022.',
  },
  {
    code: 'DHSE_KL',
    name: 'Directorate of General Education (Higher Secondary Wing), Kerala',
    description:
      'Kerala; conducts the Higher Secondary Examination (Class XII). Formerly the Directorate of Higher Secondary Education (DHSE).',
  },
  {
    code: 'VHSE_KL',
    name: 'Board of Vocational Higher Secondary Education, Kerala',
    description:
      'Kerala; conducts the Vocational Higher Secondary Examination (Class XII).',
  },
  {
    code: 'MPBSE',
    name: 'Board of Secondary Education, Madhya Pradesh',
    description:
      'Madhya Pradesh; conducts the Higher Secondary Certificate (Class XII) examination.',
  },
  {
    code: 'MSBSHSE',
    name: 'Maharashtra State Board of Secondary and Higher Secondary Education',
    description: 'Maharashtra; conducts the HSC (Class XII) examination.',
  },
  {
    code: 'COHSEM',
    name: 'Council of Higher Secondary Education, Manipur',
    description:
      'Manipur; conducts the Higher Secondary (Class XII) examination.',
  },
  {
    code: 'MBOSE',
    name: 'Meghalaya Board of School Education',
    description: 'Meghalaya; conducts the HSSLC (Class XII) examination.',
  },
  {
    code: 'MBSE',
    name: 'Mizoram Board of School Education',
    description: 'Mizoram; conducts the HSSLC (Class XII) examination.',
  },
  {
    code: 'NBSE',
    name: 'Nagaland Board of School Education',
    description: 'Nagaland; conducts the HSSLC (Class XII) examination.',
  },
  {
    code: 'CHSE_OD',
    name: 'Council of Higher Secondary Education, Odisha',
    description:
      'Odisha; conducts the Higher Secondary (+2 / Class XII) examination.',
  },
  {
    code: 'PSEB',
    name: 'Punjab School Education Board',
    description:
      'Punjab; conducts the Senior Secondary (Class XII) examination.',
  },
  {
    code: 'RBSE',
    name: 'Board of Secondary Education, Rajasthan',
    description:
      'Rajasthan; conducts the Senior Secondary (Class XII) examination.',
  },
  {
    code: 'TN_DGE',
    name: 'Directorate of Government Examinations, Tamil Nadu',
    description:
      'Tamil Nadu; conducts the HSC (+2 / Class XII) public examination. Styled the Board of Higher Secondary Examinations.',
  },
  {
    code: 'TGBIE',
    name: 'Telangana Board of Intermediate Education',
    description:
      'Telangana; conducts the Intermediate (Class XI–XII) public examinations. Certificates issued before the 2024 TS→TG renaming say TSBIE.',
  },
  {
    code: 'TBSE',
    name: 'Tripura Board of Secondary Education',
    description:
      'Tripura; conducts the Higher Secondary (+2 / Class XII) examination.',
  },
  {
    code: 'UPMSP',
    name: 'Board of High School and Intermediate Education, Uttar Pradesh',
    description:
      'Uttar Pradesh; conducts the Intermediate (Class XII) examination. Also known as Uttar Pradesh Madhyamik Shiksha Parishad.',
  },
  {
    code: 'UBSE',
    name: 'Board of School Education Uttarakhand',
    description:
      'Uttarakhand; conducts the Intermediate (Class XII) examination.',
  },
  {
    code: 'WBCHSE',
    name: 'West Bengal Council of Higher Secondary Education',
    description:
      'West Bengal; conducts the Higher Secondary (Class XII) examination.',
  },
  {
    code: 'CAIE',
    name: 'Cambridge Assessment International Education',
    description:
      'International board; issues A and AS Level, which AIU treats as Class XII equivalent.',
  },
  {
    code: 'IB',
    name: 'International Baccalaureate',
    description:
      'International board; issues the IB Diploma Programme, which AIU treats as Class XII equivalent.',
  },
  {
    code: 'PEARSON_EDEXCEL',
    name: 'Pearson Edexcel',
    description:
      'International board; issues the International A Level, which AIU treats as Class XII equivalent.',
  },
];

// Polytechnic diploma — the 3-year engineering/technology diploma used for
// lateral entry into 2nd year B.Tech.
//
// Not all of these are boards: Gujarat, Madhya Pradesh and Chhattisgarh award
// through a technical university, and several states run the board inside a
// directorate. The row names the body that actually certifies the diploma.
const DIPLOMA: BoardSeed[] = [
  {
    code: 'SBTET_AP',
    name: 'State Board of Technical Education and Training, Andhra Pradesh',
    description:
      'Andhra Pradesh; awards 3-year polytechnic diplomas in engineering and technology.',
    is_active: true,
  },
  {
    code: 'SBTET_TS',
    name: 'State Board of Technical Education and Training, Telangana',
    description:
      'Telangana; awards 3-year polytechnic diplomas in engineering and technology.',
  },
  {
    code: 'MSBTE',
    name: 'Maharashtra State Board of Technical Education',
    description:
      'Maharashtra; autonomous statutory board (Act XXXVIII of 1997) awarding diplomas in engineering, technology and pharmacy. Also serves Andaman & Nicobar.',
  },
  {
    code: 'BTE_KA',
    name: 'Board of Technical Examination, Karnataka',
    description:
      'Karnataka; board under the Department of Technical Education that conducts diploma examinations and awards polytechnic diplomas.',
  },
  {
    code: 'SBTET_TN',
    name: 'State Board of Technical Education and Training, Tamil Nadu',
    description:
      'Tamil Nadu; board within the Directorate of Technical Education (DOTE) that awards polytechnic diplomas.',
  },
  {
    code: 'SBTE_KL',
    name: 'State Board of Technical Education, Kerala',
    description:
      'Kerala; board under the Directorate of Technical Education that affiliates polytechnics and awards technical diplomas.',
  },
  {
    code: 'GTU',
    name: 'Gujarat Technological University',
    description:
      'Gujarat; state technical university awarding polytechnic diplomas through affiliated polytechnics. Also serves Dadra & Nagar Haveli and Daman & Diu.',
  },
  {
    code: 'BTER_RJ',
    name: 'Board of Technical Education, Rajasthan',
    description:
      'Rajasthan; state board at Jodhpur awarding diplomas in engineering, pharmacy and applied arts.',
  },
  {
    code: 'BTEUP',
    name: 'Board of Technical Education, Uttar Pradesh',
    description:
      'Uttar Pradesh; statutory board at Lucknow (established 1958) awarding polytechnic diplomas.',
  },
  {
    code: 'RGPV',
    name: 'Rajiv Gandhi Proudyogiki Vishwavidyalaya (Diploma Wing)',
    description:
      'Madhya Pradesh; its Diploma Wing awards polytechnic diplomas. Took over from the erstwhile MP Board of Technical Education, dissolved in 1999-2000.',
  },
  {
    code: 'SBTE_BR',
    name: 'State Board of Technical Education, Bihar',
    description:
      'Bihar; board at Patna under DSTTE that examines and certifies 6-semester polytechnic diplomas.',
  },
  {
    code: 'WBSCTVESD',
    name: 'West Bengal State Council of Technical & Vocational Education and Skill Development',
    description:
      'West Bengal; statutory council awarding polytechnic diplomas through its Technical Education Division.',
  },
  {
    code: 'SCTEVT_OD',
    name: 'State Council for Technical Education & Vocational Training, Odisha',
    description:
      'Odisha; autonomous statutory body (established 1994) at Bhubaneswar that examines and certifies 3-year diplomas and ITI programmes.',
  },
  {
    code: 'PSBTE_IT',
    name: 'Punjab State Board of Technical Education & Industrial Training',
    description:
      'Punjab; autonomous statutory board (1992 Act) awarding polytechnic diplomas. Its remit expressly covers Chandigarh UT.',
  },
  {
    code: 'HSBTE',
    name: 'Haryana State Board of Technical Education',
    description:
      'Haryana; board at Panchkula (Haryana Act 19 of 2008) awarding diplomas in engineering, pharmacy, architecture and management.',
  },
  {
    code: 'HPTSB',
    name: 'Himachal Pradesh Takniki Shiksha Board',
    description:
      'Himachal Pradesh; board at Dharamshala (H.P. Takniki Shiksha Board Act, 1986) awarding polytechnic diplomas.',
  },
  {
    code: 'UBTER',
    name: 'Uttarakhand Board of Technical Education',
    description:
      'Uttarakhand; board at Roorkee (Act 27 of 2003) awarding polytechnic diplomas.',
  },
  {
    code: 'SBTE_JH',
    name: 'State Board of Technical Education, Jharkhand',
    description:
      'Jharkhand; conducts diploma examinations and certifies polytechnic diplomas. Admissions run separately through JCECEB.',
  },
  {
    code: 'CSVTU',
    name: 'Chhattisgarh Swami Vivekanand Technical University',
    description:
      'Chhattisgarh; state technical university at Bhilai awarding polytechnic diplomas through its affiliated polytechnics.',
  },
  {
    code: 'SCTE_AS',
    name: 'State Council for Technical Education, Assam',
    description:
      'Assam; council under the Directorate of Technical Education (constituted 1956) conducting diploma examinations.',
  },
  {
    code: 'BTE_DL',
    name: 'Board of Technical Education, Delhi',
    description:
      'NCT of Delhi; board under the Directorate of Training and Technical Education (established 1963-64) awarding 3-year polytechnic diplomas.',
  },
  {
    code: 'BTE_GA',
    name: 'Board of Technical Education, Goa State',
    description:
      'Goa; board under the Directorate of Technical Education (notified 1988) awarding polytechnic diplomas.',
  },
  {
    code: 'JKBOTE',
    name: 'Jammu and Kashmir Board of Technical Education',
    description:
      'UTs of Jammu & Kashmir and Ladakh; autonomous board awarding polytechnic diplomas. Did not split after the 2019 reorganisation.',
  },
  {
    code: 'SBTE_SK',
    name: 'State Board of Technical Education, Sikkim',
    description:
      'Sikkim; board under the Board of Technical Education Act, 2002 certifying technical diplomas.',
  },
  {
    code: 'SCTE_ML',
    name: 'Meghalaya State Council for Technical Education',
    description:
      'Meghalaya; statutory council under the Directorate of Higher and Technical Education awarding technical diplomas.',
  },
  {
    code: 'SCTE_NL',
    name: 'State Council for Technical Education, Nagaland',
    description:
      'Nagaland; council under the Directorate of Technical Education awarding technical diplomas.',
  },
  {
    code: 'SCTE_AR',
    name: 'Arunachal Pradesh State Council for Technical Education',
    description:
      'Arunachal Pradesh; statutory council under the Directorate of Higher and Technical Education awarding technical diplomas.',
  },
];

export const EDUCATION_BOARDS: EducationBoardsSeed = {
  x: X,
  xii: XII,
  diploma: DIPLOMA,
};
