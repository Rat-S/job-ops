import json
import asyncio
import os
import sys

# Add the src directory to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from schemas import Constraints, WritingStyle
from flows import tailor_resume_flow
from compact import filter_resume_for_summary

with open("../../data/master-resume.json", "r") as f:
    master_resume = json.load(f)

async def main():
    try:
        res = await tailor_resume_flow(
            job_description="Looking for Principal Product Manager with AI experience",
            master_resume=master_resume,
            writing_style=WritingStyle(tone="professional", formality="medium", manualLanguage="english"),
            constraints={"maxPages": 2, "targetKeywords": []}
        )
        print("Done!")
    except Exception as e:
        print("Error:", e)
        import traceback
        traceback.print_exc()

asyncio.run(main())
